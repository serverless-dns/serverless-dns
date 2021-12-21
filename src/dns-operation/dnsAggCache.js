/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import DNSBlockOperation from "./dnsBlockOperation.js";
import { BlocklistFilter } from "../blocklist-wrapper/blocklistWrapper.js";
import * as util from "../helpers/util.js";
import * as dnsutil from "../helpers/dnsutil.js";

export default class DNSAggCache {
  constructor() {
    this.dnsBlockOperation = new DNSBlockOperation();
    this.blocklistFilter = new BlocklistFilter();
  }
  /**
   * @param {*} param
   * @param {*} param.userBlocklistInfo
   * @param {*} param.request
   * @param {*} param.requestBodyBuffer
   * @param {*} param.isAggCacheReq
   * @param {*} param.isDnsMsg
   * @param {*} param.dnsCache
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
      console.error("Error At : DNSAggCache -> RethinkModule", e);
    }
    return response;
  }

  async aggCache(param) {
    let response = {};
    response.reqDecodedDnsPacket = dnsutil.decode(param.requestBodyBuffer);
    response.aggCacheResponse = {};
    response.aggCacheResponse.type = "none";

    if (param.isAggCacheReq) {
      const key = (response.reqDecodedDnsPacket.questions.length > 0
        ? response.reqDecodedDnsPacket.questions[0].name
        : "").trim().toLowerCase() +
        ":" + response.reqDecodedDnsPacket.questions[0].type;
      let cacheResponse = await param.dnsCache.get(key, param.request.url);
      console.debug("Cache Response", JSON.stringify(cacheResponse));
      if (cacheResponse) {
        response.aggCacheResponse = await parseCacheResponse(
          cacheResponse,
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
async function parseCacheResponse(
  cacheResponse,
  dnsBlockOperation,
  blocklistFilter,
  userBlocklistInfo,
  reqDecodedDnsPacket,
) {
  let response = {};
  response.type = "none";
  response.data = {};
  //check whether incoming request should be blocked by blocklist filter
  if (
    (reqDecodedDnsPacket.questions[0].type == "A" ||
      reqDecodedDnsPacket.questions[0].type == "AAAA" ||
      reqDecodedDnsPacket.questions[0].type == "CNAME" ||
      reqDecodedDnsPacket.questions[0].type == "HTTPS" ||
      reqDecodedDnsPacket.questions[0].type == "SVCB") &&
    metaData.blocklistInfo &&
    !util.emptyString(userBlocklistInfo.userBlocklistFlagUint)
  ) {
    const blocklistInfoMap = new Map(Object.entries(cacheResponse.metaData.blocklistInfo));
    let blockResponse = dnsBlockOperation.checkDomainBlocking(
      userBlocklistInfo.userBlocklistFlagUint,
      userBlocklistInfo.userServiceListUint,
      userBlocklistInfo.flagVersion,
      blocklistInfoMap,
      blocklistFilter,
      reqDecodedDnsPacket.questions[0].name.trim().toLowerCase(),
    );
    if (blockResponse.isBlocked) {
      response.type = "blocked";
      response.data = blockResponse;
      return response;
    }
  }
  if (cacheResponse.metaData.bodyUsed) {
    const now = Date.now();
    if (now <= (cacheResponse.metaData.ttlEndTime)) {
      response.type = "response";
      response.data.decodedDnsPacket = cacheResponse.decodedDnsPacket
      const outttl = Math.max(
        Math.floor((cacheResponse.metaData.ttlEndTime - now) / 1000),
        1,
      ); // to verify ttl is not set to 0sec
      for (let answer of response.data.decodedDnsPacket.answers) {
        answer.ttl = outttl;
      }
      response.data.bodyBuffer = dnsutil.encode(
        response.data.decodedDnsPacket,
      );
    }
  }

  return response;
}
