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
import * as util from "../helpers/util.js";

export default class DNSQuestionBlock {
  constructor() {
    this.log = log.withTags("DnsQuestionBlock");
  }

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
    let response = util.emptyResponse();

    try {
      response.data = this.dnsBlock(param);
    } catch (e) {
      this.log.e(param.rxid, "main", e);
      response = util.errResponse("DNSQuestionBlock", e);
    }

    return response;
  }

  dnsBlock(param) {
    const response = this.performBlocking(
      param.rxid,
      param.userBlocklistInfo,
      param.requestDecodedDnsPacket,
      param.blocklistFilter,
      /* cache-filter*/ false
    );
    // FIXME: move cache-ops to callbacks in plugin.js
    if (response && response.isBlocked) {
      this.log.d(param.rxid, "cache block-response");
      putCache(
        param.dnsCache,
        param.request.url,
        param.blocklistFilter,
        param.requestDecodedDnsPacket,
        /* buffer*/ "",
        param.event
      );
    }
    return response;
  }

  performBlocking(rxid, blockInfo, dnsPacket, blf, cf) {
    if (!cf && !blf) {
      this.log.w(rxid, "no cf and blf");
      return false;
    }

    if (!dnsutil.hasBlockstamp(blockInfo)) {
      this.log.d(rxid, "no user-set blockstamp");
      return false;
    }

    if (!dnsutil.isBlockable(dnsPacket)) {
      this.log.d(rxid, "not a blockable dns-query");
      return false;
    }

    const qn = dnsutil.getQueryName(dnsPacket.questions);
    if (!qn) return false;

    return dnsBlockUtil.doBlock(blf, blockInfo, qn, cf);
  }
}

function putCache(cache, url, blf, dnsPacket, buf, event) {
  const key = dnsCacheUtil.cacheKey(dnsPacket);
  if (!key) return;

  const value = dnsCacheUtil.createCacheInput(dnsPacket, blf);
  cache.put(key, value, url, buf, event);
}
