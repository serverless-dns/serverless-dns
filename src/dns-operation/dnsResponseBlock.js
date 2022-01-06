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
    let response = util.emptyResponse();

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
      this.log.e(param.rxid, "main", e);
      response = util.errResponse("DnsResponseBlock", e);
    }

    return response;
  }

  performBlocking(rxid, blockInfo, dnsPacket, blf, cf) {
    // both cache-filters for the domain and the blocklist-filter missing
    // and so there's no way to know if the domain could be blocked
    if (!cf && !blf) {
      this.log.w(rxid, "no cf and blf");
      return false;
    }

    if (!dnsutil.hasBlockstamp(blockInfo)) {
      this.log.d(rxid, "no user-set blockstamp");
      return false;
    }

    // dnsPacket is null when cache only has metadata
    if (util.emptyBuf(dnsPacket)) {
      this.log.d(rxid, "no dns-packet ans");
      return false;
    }

    if (!dnsutil.isCname(dnsPacket) && !dnsutil.isHttps(dnsPacket)) {
      this.log.d(rxid, "ans not cloaked with cname/https/svcb");
      return false;
    }

    return doResponseBlock(dnsPacket, blf, blockInfo, cf);
  }

  putCache(rxid, cache, url, blf, dnsPacket, buf, event) {
    if (util.emptyBuf(dnsPacket)) return;

    if (!dnsCacheUtil.isCacheable(dnsPacket)) return;

    const k = dnsCacheUtil.cacheKey(dnsPacket);
    if (!k) return;

    const v = dnsCacheUtil.createCacheInput(dnsPacket, blf);
    this.log.d(rxid, "put-cache k/v ", k, v);
    cache.put(k, v, url, buf, event);
  }
}

function doResponseBlock(dnsPacket, blf, blockInfo, cf) {
  const names = dnsutil.extractDomains(dnsPacket);
  let r = false;
  for (const n of names) {
    r = dnsBlockUtil.doBlock(blf, blockInfo, n, cf);
    if (r.isBlocked) break;
  }
  return r;
}
