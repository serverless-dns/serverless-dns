/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { createBlocklistFilter } from "./radixTrie.js";
import { BlocklistFilter } from "./blocklistFilter.js";
let debug = false;
class BlocklistWrapper {
  constructor() {
    this.blocklistFilter = new BlocklistFilter();
    this.startTime;
    this.isBlocklistUnderConstruction = false;
    this.exceptionFrom = "";
    this.exceptionStack = "";
  }

  /**
   * @param {*} param
   * @param {String} param.blocklistUrl
   * @param {String} param.latestTimestamp
   * @param {Number} param.workerTimeout
   * @param {Number} param.tdParts
   * @param {Number} param.tdNodecount
   * @param {Number} param.fetchTimeout
   * @returns
   */
  async RethinkModule(param) {
    let response = {};
    response.isException = false;
    response.exceptionStack = "";
    response.exceptionFrom = "";
    response.data = {};
    if (this.blocklistFilter.t !== null) {
      response.data.blocklistFilter = this.blocklistFilter;
      return response;
    }
    try {
      const now = Date.now();
      if (this.isBlocklistUnderConstruction === false) {
        return await this.initBlocklistConstruction(
          now,
          param.blocklistUrl,
          param.latestTimestamp,
          param.tdNodecount,
          param.tdParts,
        );
      } else if ((now - this.startTime) > (param.workerTimeout * 2)) {
        return await this.initBlocklistConstruction(
          now,
          param.blocklistUrl,
          param.latestTimestamp,
          param.tdNodecount,
          param.tdParts,
        );
      } else { // someone's constructing... wait till finished
        // res.arrayBuffer() is the most expensive op, taking anywhere
        // between 700ms to 1.2s for trie. But: We don't want all incoming
        // reqs to wait until the trie becomes available. 400ms is 1/3rd of
        // 1.2s and 2x 250ms; both of these values have cost implications:
        // 250ms (0.28GB-sec or 218ms wall time) in unbound usage per req
        // equals cost of one bundled req.
        // going back to direct-s3 download as worker-bundled blocklist files download
        // gets triggered for 10% of requests.
        let totalWaitms = 0;
        const waitms = 50;
        while (totalWaitms < param.fetchTimeout) {
          if (this.blocklistFilter.t !== null) {
            response.data.blocklistFilter = this.blocklistFilter;
            return response;
          }
          await sleep(waitms);
          totalWaitms += waitms;
        }
        response.isException = true;
        response.exceptionStack = (this.exceptionStack)
          ? this.exceptionStack
          : "Problem in loading blocklistFilter - Waiting Timeout";
        response.exceptionFrom = (this.exceptionFrom)
          ? this.exceptionFrom
          : "blocklistWrapper.js RethinkModule";
      }
    } catch (e) {
      response.isException = true;
      response.exceptionStack = e.stack;
      response.exceptionFrom = "blocklistWrapper.js RethinkModule";
      console.error("Error At -> BlocklistWrapper RethinkModule");
      console.error(e.stack);
    }
    return response;
  }

  async initBlocklistConstruction(
    when,
    blocklistUrl,
    latestTimestamp,
    tdNodecount,
    tdParts,
  ) {
    this.isBlocklistUnderConstruction = true;
    this.startTime = when;

    let response = {};
    response.isException = false;
    response.exceptionStack = "";
    response.exceptionFrom = "";
    response.data = {};

    try {
      let bl = await downloadBuildBlocklist(
        blocklistUrl,
        latestTimestamp,
        tdNodecount,
        tdParts,
      );

      this.blocklistFilter.loadFilter(
        bl.t,
        bl.ft,
        bl.blocklistBasicConfig,
        bl.blocklistFileTag,
      );

      if (debug) {
        console.log("done blocklist filter");
        let result = this.blocklistFilter.getDomainInfo("google.com");
        console.log(JSON.stringify(result));
        console.log(JSON.stringify(result.searchResult.get("google.com")));
      }

      this.isBlocklistUnderConstruction = false;
      response.data.blocklistFilter = this.blocklistFilter;
    } catch (e) {
      this.isBlocklistUnderConstruction = false;
      response.isException = true;
      response.exceptionStack = e.stack;
      response.exceptionFrom = "blocklistWrapper.js initBlocklistConstruction";
      this.exceptionFrom = response.exceptionFrom;
      this.exceptionStack = response.exceptionStack;
      console.error(e.stack);
    }
    return response;
  }
}

//Add needed env variables to param
async function downloadBuildBlocklist(
  blocklistUrl,
  latestTimestamp,
  tdNodecount,
  tdParts,
) {
  try {
    let resp = {};
    const baseurl = blocklistUrl + latestTimestamp;
    let blocklistBasicConfig = {
      nodecount: tdNodecount || -1,
      tdparts: tdParts || -1,
    };

    tdNodecount == null &&
      console.error("tdNodecount missing! Blocking won't work");
    const buf0 = fileFetch(baseurl + "/filetag.json", "json");
    const buf1 = makeTd(baseurl, blocklistBasicConfig.tdparts);
    const buf2 = fileFetch(baseurl + "/rd.txt", "buffer");

    let downloads = await Promise.all([buf0, buf1, buf2]);

    if (debug) {
      console.log("call createBlocklistFilter");
      console.log(blocklistBasicConfig);
    }

    let trie = createBlocklistFilter(
      downloads[1],
      downloads[2],
      downloads[0],
      blocklistBasicConfig,
    );

    resp.t = trie.t;
    resp.ft = trie.ft;
    resp.blocklistBasicConfig = blocklistBasicConfig;
    resp.blocklistFileTag = downloads[0];
    return resp;
  } catch (e) {
    throw e;
  }
}

async function fileFetch(url, typ) {
  if (typ !== "buffer" && typ !== "json") {
    throw new Error("Unknown conversion type at fileFetch");
  }
  if (debug) {
    console.log("Start Downloading : " + url);
  }
  const res = await fetch(url, { cf: { cacheTtl: /*2w*/ 1209600 } });
  if (res.status == 200) {
    if (typ == "buffer") {
      return await res.arrayBuffer();
    } else if (typ == "json") {
      return await res.json();
    }
  } else {
    console.error(url, res);
    throw new Error(
      JSON.stringify([url, res, "response status unsuccessful at fileFetch"]),
    );
  }
}

const sleep = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

// joins split td parts into one td
async function makeTd(baseurl, n) {
  if (debug) {
    console.log("Make Td Starts : Tdparts -> " + n);
  }
  if (n <= -1) {
    return fileFetch(baseurl + "/td.txt", "buffer");
  }
  const tdpromises = [];
  for (let i = 0; i <= n; i++) {
    // td00.txt, td01.txt, td02.txt, ... , td98.txt, td100.txt, ...
    const f = baseurl + "/td" +
      (i).toLocaleString("en-US", {
        minimumIntegerDigits: 2,
        useGrouping: false,
      }) + ".txt";
    tdpromises.push(fileFetch(f, "buffer"));
  }
  const tds = await Promise.all(tdpromises);

  if (debug) {
    console.log("all td download successful");
  }

  return new Promise((resolve, reject) => {
    resolve(concat(tds));
  });
}

// stackoverflow.com/a/40108543/
// Concatenate a mix of typed arrays
function concat(arraybuffers) {
  let sz = arraybuffers.reduce(
    (sum, a) => sum + a.byteLength,
    0,
  );
  let buf = new ArrayBuffer(sz);
  let cat = new Uint8Array(buf);
  let offset = 0;
  for (let a of arraybuffers) {
    // github: jessetane/array-buffer-concat/blob/7d79d5ebf/index.js#L17
    const v = new Uint8Array(a);
    cat.set(v, offset);
    offset += a.byteLength;
  }
  return buf;
}

export { BlocklistFilter, BlocklistWrapper };
