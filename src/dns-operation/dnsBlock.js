/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as dnsutil from "../helpers/dnsutil.js";
import * as dnsCacheUtil from "../helpers/cacheutil.js";
import * as dnsBlockUtil from "../helpers/dnsblockutil.js";

export default class DNSQuestionBlock {
  constructor() {}

  /**
   * @param {*} param
   * @param {*} param.userBlocklistInfo
   * @param {*} param.blocklistFilter
   * @param {*} param.requestDecodedDnsPacket
   * @param {*} param.event
   * @param {*} param.request
   * @param {*} param.dnsCache
   * @returns
   */
  async RethinkModule(param) {
    const response = {};
    response.isException = false;
    response.exceptionStack = "";
    response.exceptionFrom = "";
    response.data = false;
    try {
      response.data = this.dnsBlock(param);
    } catch (e) {
      response.isException = true;
      response.exceptionStack = e.stack;
      response.exceptionFrom = "DNSQuestionBlock RethinkModule";
      console.error("Error At : DNSQuestionBlock -> RethinkModule");
      console.error(e.stack);
    }
    return response;
  }

  dnsBlock(param) {
    const response = this.performBlocking(
      param.userBlocklistInfo,
      param.requestDecodedDnsPacket,
      param.blocklistFilter,
      false
    );
    if (response && response.isBlocked) {
      console.debug("add block response to cache");
      putCache(
        param.dnsCache,
        param.request.url,
        param.blocklistFilter,
        param.requestDecodedDnsPacket,
        "",
        param.event
      );
    }
    return response;
  }

  performBlocking(blockInfo, dnsPacket, blf, cf) {
    if (
      !blockInfo.userBlocklistFlagUint ||
      blockInfo.userBlocklistFlagUint === "" ||
      !dnsutil.isBlockable(dnsPacket)
    ) {
      return false;
    }

    const qn = dnsutil.getQueryName(dnsPacket.questions);
    if (!qn) return false;
    return dnsBlockUtil.doBlock(blf, blockInfo, qn, cf);
  }
}

function putCache(cache, url, blf, dnsPacket, buf, event) {
  const key = dnsCacheutil.cacheKey(dnsPacket);
  if (!key) return;
  const input = dnsCacheUtil.createCacheInput(dnsPacket, blf, false);
  cache.put(key, input, url, buf, event);
}
