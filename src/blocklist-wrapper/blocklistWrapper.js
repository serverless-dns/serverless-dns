/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { createBlocklistFilter } from "./radixTrie.js";
import { BlocklistFilter } from "./blocklistFilter.js";

class BlocklistWrapper {
  constructor() {
    this.blocklistFilter = new BlocklistFilter();
    this.startTime;
    this.td = null; // trie
    this.rd = null; // rank-dir
    this.ft = null; // file-tags
    this.isBlocklistUnderConstruction = false;
    this.exceptionFrom = "";
    this.exceptionStack = "";
    this.log = log.withTags("BlocklistWrapper");
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
    const response = {};
    response.isException = false;
    response.exceptionStack = "";
    response.exceptionFrom = "";
    response.data = {};

    if (this.isBlocklistFilterSetup()) {
      response.data.blocklistFilter = this.blocklistFilter;
      return response;
    }

    try {
      const now = Date.now();

      if (this.isBlocklistUnderConstruction === false) {
        return await this.initBlocklistConstruction(
          param.rxid,
          now,
          param.blocklistUrl,
          param.latestTimestamp,
          param.tdNodecount,
          param.tdParts
        );
      } else if (now - this.startTime > param.workerTimeout * 2) {
        // it has been a while, queue another blocklist-construction
        return await this.initBlocklistConstruction(
          param.rxid,
          now,
          param.blocklistUrl,
          param.latestTimestamp,
          param.tdNodecount,
          param.tdParts
        );
      } else {
        // someone's constructing... wait till finished
        // res.arrayBuffer() is the most expensive op, taking anywhere
        // between 700ms to 1.2s for trie. But: We don't want all incoming
        // reqs to wait until the trie becomes available. 400ms is 1/3rd of
        // 1.2s and 2x 250ms; both of these values have cost implications:
        // 250ms (0.28GB-sec or 218ms wall time) in unbound usage per req
        // equals cost of one bundled req.
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
        response.exceptionStack =
          this.exceptionStack || "blocklist filter not ready";
        response.exceptionFrom =
          this.exceptionFrom || "blocklistWrapper.js RethinkModule";
      }
    } catch (e) {
      response.isException = true;
      response.exceptionStack = e.stack;
      response.exceptionFrom = "blocklistWrapper.js RethinkModule";
      log.e(param.rxid, "RethinkModule", e);
    }
    return response;
  }

  isBlocklistFilterSetup() {
    return this.blocklistFilter && this.blocklistFilter.t;
  }

  initBlocklistFilterConstruction(td, rd, ft, config) {
    this.isBlocklistUnderConstruction = true;
    const filter = createBlocklistFilter(
      /* trie*/ td,
      /* rank-dir*/ rd,
      /* file-tags*/ ft,
      /* basic-config*/ config
    );
    this.blocklistFilter.loadFilter(
      /* trie*/ filter.t,
      /* frozen-trie*/ filter.ft,
      /* basic-config*/ filter.blocklistBasicConfig,
      /* file-tags*/ filter.blocklistFileTag
    );
    this.isBlocklistUnderConstruction = false;
  }

  async initBlocklistConstruction(
    rxid,
    when,
    blocklistUrl,
    latestTimestamp,
    tdNodecount,
    tdParts
  ) {
    this.isBlocklistUnderConstruction = true;
    this.startTime = when;

    const response = {};
    response.isException = false;
    response.exceptionStack = "";
    response.exceptionFrom = "";
    response.data = {};

    try {
      const bl = await this.downloadBuildBlocklist(
        rxid,
        blocklistUrl,
        latestTimestamp,
        tdNodecount,
        tdParts
      );

      this.blocklistFilter.loadFilter(
        bl.t,
        bl.ft,
        bl.blocklistBasicConfig,
        bl.blocklistFileTag
      );

      log.d(rxid, "loaded blocklist-filter");
      if (false) {
        // test
        const result = this.blocklistFilter.getDomainInfo("google.com");
        log.d(rxid, JSON.stringify(result));
      }

      response.data.blocklistFilter = this.blocklistFilter;
    } catch (e) {
      response.isException = true;
      response.exceptionStack = e.stack;
      response.exceptionFrom = "blocklistWrapper.js initBlocklistConstruction";
      this.exceptionFrom = response.exceptionFrom;
      this.exceptionStack = response.exceptionStack;
      log.e(rxid, e);
    }

    this.isBlocklistUnderConstruction = false;

    return response;
  }

  async downloadBuildBlocklist(
    rxid,
    blocklistUrl,
    latestTimestamp,
    tdNodecount,
    tdParts
  ) {
    !tdNodecount && log.e(rxid, "tdNodecount zero or missing!");

    const resp = {};
    const baseurl = blocklistUrl + latestTimestamp;
    const blocklistBasicConfig = {
      nodecount: tdNodecount || -1,
      tdparts: tdParts || -1,
    };

    const buf0 = fileFetch(baseurl + "/filetag.json", "json");
    const buf1 = makeTd(baseurl, blocklistBasicConfig.tdparts);
    const buf2 = fileFetch(baseurl + "/rd.txt", "buffer");

    const downloads = await Promise.all([buf0, buf1, buf2]);

    log.d(rxid, "call createBlocklistFilter", blocklistBasicConfig);

    this.td = downloads[1];
    this.rd = downloads[2];
    this.ft = downloads[0];

    const trie = createBlocklistFilter(
      /* trie*/ this.td,
      /* rank-dir*/ this.rd,
      /* file-tags*/ this.ft,
      /* basic-config*/ blocklistBasicConfig
    );

    resp.t = trie.t; // tags
    resp.ft = trie.ft; // frozen-trie
    resp.blocklistBasicConfig = blocklistBasicConfig;
    resp.blocklistFileTag = this.ft;
    return resp;
  }
}

async function fileFetch(url, typ) {
  if (typ !== "buffer" && typ !== "json") {
    throw new Error("Unknown conversion type at fileFetch");
  }
  log.d("Start Downloading : " + url);
  const res = await fetch(url, { cf: { cacheTtl: /* 2w*/ 1209600 } });
  if (res.status === 200) {
    if (typ === "buffer") {
      return await res.arrayBuffer();
    } else if (typ === "json") {
      return await res.json();
    }
  } else {
    log.e(url, res);
    throw new Error(JSON.stringify([url, res, "fileFetch fail"]));
  }
}

const sleep = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

// joins split td parts into one td
async function makeTd(baseurl, n) {
  log.d("Make Td Starts : Tdparts -> " + n);

  if (n <= -1) {
    return fileFetch(baseurl + "/td.txt", "buffer");
  }
  const tdpromises = [];
  for (let i = 0; i <= n; i++) {
    // td00.txt, td01.txt, td02.txt, ... , td98.txt, td100.txt, ...
    const f =
      baseurl +
      "/td" +
      i.toLocaleString("en-US", {
        minimumIntegerDigits: 2,
        useGrouping: false,
      }) +
      ".txt";
    tdpromises.push(fileFetch(f, "buffer"));
  }
  const tds = await Promise.all(tdpromises);

  log.d("tds downloaded");

  return new Promise((resolve, reject) => {
    resolve(concat(tds));
  });
}

// stackoverflow.com/a/40108543/
// Concatenate a mix of typed arrays
function concat(arraybuffers) {
  const sz = arraybuffers.reduce((sum, a) => sum + a.byteLength, 0);
  const buf = new ArrayBuffer(sz);
  const cat = new Uint8Array(buf);
  let offset = 0;
  for (const a of arraybuffers) {
    // github: jessetane/array-buffer-concat/blob/7d79d5ebf/index.js#L17
    const v = new Uint8Array(a);
    cat.set(v, offset);
    offset += a.byteLength;
  }
  return buf;
}

export { BlocklistFilter, BlocklistWrapper };
