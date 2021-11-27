/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { createBlocklistFilter } from "./radixTrie.js";
import { BlocklistFilter } from "./blocklistFilter.js";

export class BlocklistWrapper {
  constructor() {
    this.blocklistFilter = null;
    this.startTime;
    this.isBlocklistUnderConstruction = false;
    this.isException = false;
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
   * @returns
   */
  async RethinkModule(param) {
    let response = {};
    response.isException = false;
    response.exceptionStack = "";
    response.exceptionFrom = "";
    response.data = {};
    try {
      let now = Date.now();
      if (
        this.blocklistFilter == null &&
        this.isBlocklistUnderConstruction == false
      ) {
        this.isBlocklistUnderConstruction = true;
        this.startTime = Date.now();
        return await this.initBlocklistConstruction(
          param.blocklistUrl,
          param.latestTimestamp,
          param.tdNodecount,
          param.tdParts,
        );
      } else if (
        this.blocklistFilter == null &&
        this.isBlocklistUnderConstruction == true &&
        (now - this.startTime) > param.workerTimeout
      ) {
        this.startTime = Date.now();
        this.isException = false;
        return await this.initBlocklistConstruction(
          param.blocklistUrl,
          param.latestTimestamp,
          param.tdNodecount,
          param.tdParts,
        );
      } else {
        // res.arrayBuffer() is the most expensive op, taking anywhere
        // between 700ms to 1.2s for trie. But: We don't want all incoming
        // reqs to wait until the trie becomes available. 400ms is 1/3rd of
        // 1.2s and 2x 250ms; both of these values have cost implications:
        // 250ms (0.28GB-sec or 218ms wall time) in unbound usage per req
        // equals cost of one bundled req.
        let retryCount = 0;
        const retryLimit = 14; // 14 * waitms == 700ms
        const waitms = 50;
        while (
          this.isBlocklistUnderConstruction == true && this.isException == false
        ) {
          if (retryCount >= retryLimit) {
            break;
          }
          await sleep(waitms);
          retryCount++;
        }

        if (this.blocklistFilter != null) {
          response.data.blocklistFilter = this.blocklistFilter;
        } else if (this.isException == true) {
          response.isException = true;
          response.exceptionStack = this.exceptionStack;
          response.exceptionFrom = this.exceptionFrom;
        } else {
          response.isException = true;
          response.exceptionStack =
            "Problem in loading blocklistFilter - Waiting Timeout";
          response.exceptionFrom = "blocklistWrapper.js RethinkModule";
        }
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
    blocklistUrl,
    latestTimestamp,
    tdNodecount,
    tdParts,
  ) {
    let response = {};
    response.isException = false;
    response.exceptionStack = "";
    response.exceptionFrom = "";
    response.data = {};

    try {
      let resp = await downloadBuildBlocklist(
        blocklistUrl,
        latestTimestamp,
        tdNodecount,
        tdParts,
      );
      this.blocklistFilter = new BlocklistFilter(
        resp.t,
        resp.ft,
        resp.blocklistBasicConfig,
        resp.blocklistFileTag,
      );
      this.isBlocklistUnderConstruction = false;
      response.data.blocklistFilter = this.blocklistFilter;
    } catch (e) {
      response.isException = true;
      response.exceptionStack = e.stack;
      response.exceptionFrom = "blocklistWrapper.js initBlocklistConstruction";
      this.isException = true;
      this.exceptionFrom = response.exceptionFrom;
      this.exceptionStack = response.exceptionStack;
      console.error("Error At -> BlocklistWrapper initBlocklistConstruction");
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
    //let now = Date.now();
    const buf0 = fileFetch(baseurl + "/filetag.json", "json");
    const buf1 = makeTd(baseurl, blocklistBasicConfig.tdparts);
    const buf2 = fileFetch(baseurl + "/rd.txt", "buffer");

    let downloads = await Promise.all([buf0, buf1, buf2]);

    //console.log("Downloaded Time : " + (Date.now() - now));
    let trie = createBlocklistFilter(
      downloads[1],
      downloads[2],
      downloads[0],
      blocklistBasicConfig,
    );

    //console.log("download and trie create Time : " + (Date.now() - now));

    resp.t = trie.t;
    resp.ft = trie.ft;
    resp.blocklistBasicConfig = blocklistBasicConfig;
    resp.blocklistFileTag = downloads[0];
    return resp;
  } catch (e) {
    throw e;
  }
}

async function fileFetch(url, type) {
  //console.log("Downloading : "+url)
  const res = await fetch(url, { cf: { cacheTtl: /*2w*/ 1209600 } });
  if (type == "buffer") {
    return await res.arrayBuffer();
  } else if (type == "json") {
    return await res.json();
  }
  throw "Unknown conversion type at fileFetch";
}

const sleep = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

// joins split td parts into one td
async function makeTd(baseurl, n) {
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
