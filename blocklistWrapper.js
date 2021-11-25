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
          //console.log("Blocklist construction wait : " + retryCount)
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
          response.exceptionStack = this.exceptionStack
          response.exceptionFrom = this.exceptionFrom
        } else {
          response.isException = true;
          response.exceptionStack = "Problem in loading blocklistFilter - Waiting Timeout"
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

  async initBlocklistConstruction(blocklistUrl, latestTimestamp) {
    let response = {};
    response.isException = false;
    response.exceptionStack = "";
    response.exceptionFrom = "";
    response.data = {};

    try {
      let resp = await downloadBuildBlocklist(
        blocklistUrl,
        latestTimestamp,
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
async function downloadBuildBlocklist(blocklistUrl, latestTimestamp) {
  try {
    let resp = {};
    const buf0 = fileFetch(
      blocklistUrl + latestTimestamp + "/basicconfig.json",
      "json",
    );
    const buf1 = fileFetch(
      blocklistUrl + latestTimestamp + "/filetag.json",
      "json",
    );
    const buf2 = fileFetch(
      blocklistUrl + latestTimestamp + "/td.txt",
      "buffer",
    );
    const buf3 = fileFetch(
      blocklistUrl + latestTimestamp + "/rd.txt",
      "buffer",
    );

    let downloads = await Promise.all([buf0, buf1, buf2, buf3]);

    let trie = await createBlocklistFilter(
      downloads[2],
      downloads[3],
      downloads[1],
      downloads[0],
    );
    resp.t = trie.t;
    resp.ft = trie.ft;
    resp.blocklistBasicConfig = downloads[0];
    resp.blocklistFileTag = downloads[1];
    return resp;
  } catch (e) {
    throw e;
  }
}

async function fileFetch(url, type) {
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
