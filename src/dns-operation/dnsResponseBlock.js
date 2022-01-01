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

export default class DNSResponseBlock {
  constructor() {}

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
        false
      );

      putCache(
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
      console.error("Error At : DNSResponseBlock -> RethinkModule");
      console.error(e.stack);
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
}

function doHttpsBlock(dnsPacket, blf, blockInfo, cf) {
  console.debug("At Https-Svcb dns Block");
  const tn = dnsutil.getTargetName(dnsPacket.answers);
  if (!tn) return false;
  return dnsBlockUtil.doBlock(blf, blockInfo, tn, cf);
}

function doCnameBlock(dnsPacket, blf, blockInfo, cf) {
  console.debug("At Cname dns Block");
  const cn = dnsutil.getCname(dnsPacket.answers);
  let response = false;
  for (const n of cn) {
    response = dnsBlockUtil.doBlock(blf, blockInfo, n, cf);
    if (response.isBlocked) break;
  }
  return response;
}

function putCache(cache, url, blf, dnsPacket, buf, event) {
  if (!dnsCacheUtil.isCacheable(dnsPacket)) return;
  const key = dnsCacheUtil.cacheKey(dnsPacket);
  if (!key) return;
  const input = dnsCacheUtil.createCacheInput(dnsPacket, blf, true);
  console.debug("Cache Input ", JSON.stringify(input));
  cache.put(key, input, url, buf, event);
}

function hasBlockstamp(blockInfo) {
  return (
    blockInfo.userBlocklistFlagUint && blockInfo.userBlocklistFlagUint !== ""
  );
}
