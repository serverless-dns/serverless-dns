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

export default class DNSResponseBlock {
  constructor() {
    this.log = log.withTags("DnsResponseBlock");
  }

  /**
   * @param {*} param
   * @param {*} param.userBlocklistInfo
   * @param {*} param.blocklistFilter
   * @param {DnsDecodedObject} param.responseDecodedDnsPacket
   * @param {} param.responseBodyBuffer
   * @param {} param.event
   * @param {} param.dnsCache
   * @param {} param.request
   * @returns
   */
  async RethinkModule(param) {
    const response = {};
    response.isException = false;
    response.exceptionStack = "";
    response.exceptionFrom = "";
    response.data = false;

    try {
      response.data = this.performBlocking(
        param.userBlocklistInfo,
        param.responseDecodedDnsPacket,
        param.blocklistFilter,
        /* cache-filter*/ false
      );

      // FIXME: move cache-ops to callbacks in plugin.js
      this.putCache(
        param.rxid,
        param.dnsCache,
        param.request.url,
        param.blocklistFilter,
        param.responseDecodedDnsPacket,
        param.responseBodyBuffer,
        param.event
      );
    } catch (e) {
      response.isException = true;
      response.exceptionStack = e.stack;
      response.exceptionFrom = "DNSResponseBlock RethinkModule";
      this.log.e(param.rxid, "main", e);
    }

    return response;
  }

  performBlocking(blockInfo, dnsPacket, blf, cf) {
    if (!hasBlockstamp(blockInfo)) {
      return false;
    } else if (dnsutil.isCname(dnsPacket)) {
      return doCnameBlock(dnsPacket, blf, blockInfo, cf);
    } else if (dnsutil.isHttps(dnsPacket)) {
      return doHttpsBlock(dnsPacket, blf, blockInfo, cf);
    }

    return false;
  }

  putCache(rxid, cache, url, blf, dnsPacket, buf, event) {
    if (!dnsCacheUtil.isCacheable(dnsPacket)) return;

    const k = dnsCacheUtil.cacheKey(dnsPacket);
    if (!k) return;

    const v = dnsCacheUtil.createCacheInput(dnsPacket, blf);
    this.log.d(rxid, "put-cache k/v ", k, v);
    cache.put(k, v, url, buf, event);
  }
}

function doHttpsBlock(dnsPacket, blf, blockInfo, cf) {
  const tn = dnsutil.getTargetName(dnsPacket.answers);
  if (!tn) return false;

  return dnsBlockUtil.doBlock(blf, blockInfo, tn, cf);
}

function doCnameBlock(dnsPacket, blf, blockInfo, cf) {
  const cn = dnsutil.getCname(dnsPacket.answers);
  let response = false;
  for (const n of cn) {
    response = dnsBlockUtil.doBlock(blf, blockInfo, n, cf);
    if (response.isBlocked) break;
  }
  return response;
}

function hasBlockstamp(blockInfo) {
  return !util.emptyString(blockInfo.userBlocklistFlagUint);
}
