/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import DNSParserWrap from "./dnsParserWrap.js";
import DNSBlockOperation from "./dnsBlockOperation.js";
import { BlocklistFilter } from "../blocklist-wrapper/blocklistWrapper.js";

export default class DNSAggCache {
  constructor() {
    this.dnsParser = new DNSParserWrap();
    this.dnsBlockOperation = new DNSBlockOperation();
    this.blocklistFilter = new BlocklistFilter();
    this.wCache = null;
  }
  /**
   * @param {*} param
   * @param {*} param.userBlocklistInfo
   * @param {*} param.request
   * @param {*} param.requestBodyBuffer
   * @param {*} param.isAggCacheReq
   * @param {*} param.isDnsMsg
   * @returns
   */
  async RethinkModule(param) {
    let response = {};
    response.isException = false;
    response.exceptionStack = "";
    response.exceptionFrom = "";
    response.data = null;
    try {
      if (!param.isDnsMsg) {
        return response;
      }
      response.data = await this.aggCache(param);
    } catch (e) {
      response.isException = true;
      response.exceptionStack = e.stack;
      response.exceptionFrom = "DNSAggCache RethinkModule";
      console.error("Error At : DNSAggCache -> RethinkModule");
      console.error(e.stack);
    }
    return response;
  }

  async aggCache(param) {
    let response = {};
    response.reqDecodedDnsPacket = this.dnsParser.Decode(
      param.requestBodyBuffer,
    );
    response.aggCacheResponse = {};
    response.aggCacheResponse.type = "none";

    if (param.isAggCacheReq && this.wCache === null) {
      this.wCache = caches.default;
    }

    if (param.isAggCacheReq) {
      const dn = (response.reqDecodedDnsPacket.questions.length > 0
        ? response.reqDecodedDnsPacket.questions[0].name
        : "").trim().toLowerCase() +
        ":" + response.reqDecodedDnsPacket.questions[0].type;
      let cacheResponse = await getCacheapi(this.wCache, param.request.url, dn);
      console.debug("Cache Api Response");
      console.debug(cacheResponse);
      if (cacheResponse) {
        response.aggCacheResponse = await parseCacheapiResponse(
          cacheResponse,
          this.dnsParser,
          this.dnsBlockOperation,
          this.blocklistFilter,
          param.userBlocklistInfo,
          response.reqDecodedDnsPacket,
        );
      }
    }
    return response;
  }
}
async function parseCacheapiResponse(
  cacheResponse,
  dnsParser,
  dnsBlockOperation,
  blocklistFilter,
  userBlocklistInfo,
  reqDecodedDnsPacket,
) {
  let response = {};
  response.type = "none";
  response.data = {};
  let metaData = JSON.parse(cacheResponse.headers.get("x-rethink-metadata"));

  console.debug("Response Found at CacheApi");
  console.debug(JSON.stringify(metaData));
  //check whether incoming request should be blocked by blocklist filter
  if (
    (reqDecodedDnsPacket.questions[0].type == "A" ||
      reqDecodedDnsPacket.questions[0].type == "AAAA" ||
      reqDecodedDnsPacket.questions[0].type == "CNAME" ||
      reqDecodedDnsPacket.questions[0].type == "HTTPS" ||
      reqDecodedDnsPacket.questions[0].type == "SVCB") &&
    metaData.blocklistInfo &&
    userBlocklistInfo.userBlocklistFlagUint !== ""
  ) {
    metaData.blocklistInfo = new Map(Object.entries(metaData.blocklistInfo));
    let blockResponse = dnsBlockOperation.checkDomainBlocking(
      userBlocklistInfo.userBlocklistFlagUint,
      userBlocklistInfo.userServiceListUint,
      userBlocklistInfo.flagVersion,
      metaData.blocklistInfo,
      blocklistFilter,
      reqDecodedDnsPacket.questions[0].name.trim().toLowerCase(),
    );
    if (blockResponse.isBlocked) {
      response.type = "blocked";
      response.data = blockResponse;
      return response;
    }
  }
  if (metaData.bodyUsed) {
    const now = Date.now();
    if (now <= (metaData.ttlEndTime)) {
      response.type = "response";
      response.data.decodedDnsPacket = dnsParser.Decode(
        await cacheResponse.arrayBuffer(),
      );
      const outttl = Math.max(
        Math.floor((metaData.ttlEndTime - now) / 1000),
        1,
      ); // to verify ttl is not set to 0sec
      for (let answer of response.data.decodedDnsPacket.answers) {
        answer.ttl = outttl;
      }
      response.data.bodyBuffer = dnsParser.Encode(
        response.data.decodedDnsPacket,
      );
    }
  }

  return response;
}

async function getCacheapi(wCache, reqUrl, key) {
  let wCacheUrl = new URL((new URL(reqUrl)).origin + "/" + key);
  return await wCache.match(wCacheUrl);
}
