/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as dnsutil from "../helpers/dnsutil.js";
import * as cacheutil from "../helpers/cacheutil.js";

export default class DNSCacheResponse {
  constructor() {
    this.log = log.withTags("DnsCacheResponse");
  }

  /**
   * @param {*} param
   * @param {*} param.userBlocklistInfo
   * @param {*} param.request
   * @param {*} param.requestDecodedDnsPacket
   * @param {*} param.isDnsMsg
   * @param {*} param.dnsCache
   * @param {*} param.dnsQuestionBlock
   * @param {*} param.dnsResponseBlock
   * @returns
   */
  async RethinkModule(param) {
    const response = {};
    response.isException = false;
    response.exceptionStack = "";
    response.exceptionFrom = "";
    response.data = {};
    try {
      if (!param.isDnsMsg) {
        return response;
      }
      response.data = await this.resolveFromCache(param);
    } catch (e) {
      response.isException = true;
      response.exceptionStack = e.stack;
      response.exceptionFrom = "DNSAggCache RethinkModule";
      this.log.e(param.rxid, "main", e);
    }
    return response;
  }

  async resolveFromCache(param) {
    const key = cacheutil.cacheKey(param.requestDecodedDnsPacket);
    if (!key) return false;

    const cacheResponse = await param.dnsCache.get(key, param.request.url);
    this.log.d(param.rxid, "resolveFromCache k/v", key, cacheResponse);

    if (!cacheResponse) return false;

    return await this.makeCacheResponse(
      param.rxid,
      cacheResponse,
      param.userBlocklistInfo,
      param.requestDecodedDnsPacket,
      param.dnsQuestionBlock,
      param.dnsResponseBlock
    );
  }

  async makeCacheResponse(rxid, cr, blockInfo, reqDnsPacket, qb, rb) {
    // check incoming dns request against blocklists in cache-metadata
    const qresponse = blockIfNeeded(
      qb,
      reqDnsPacket,
      cr.metaData.cacheFilter,
      blockInfo
    );
    this.log.d(rxid, blockInfo, "question block?", qresponse);
    if (qresponse && qresponse.isBlocked) {
      return qresponse;
    }

    // check outgoing cached dns-packet against blocklists
    const aresponse = blockIfNeeded(
      rb,
      cr.dnsPacket,
      cr.metaData.cacheFilter,
      blockInfo
    );
    this.log.d(rxid, blockInfo, "answer block?", aresponse);
    if (aresponse && aresponse.isBlocked) {
      return aresponse;
    }

    return modifyCacheResponse(cr, reqDnsPacket.id);
  }
}

function blockIfNeeded(blocker, dnsPacket, cf, blockInfo) {
  return blocker.performBlocking(blockInfo, dnsPacket, false, cf);
}

function modifyCacheResponse(cr, qid) {
  // cache-response contains only metadata not dns-packet
  if (!cr.metaData.bodyUsed) {
    return false;
  }

  cacheutil.updateQueryId(cr.dnsPacket, qid);
  cacheutil.updateTtl(cr.dnsPacket, cr.metaData.ttlEndTime);

  return {
    dnsPacket: cr.dnsPacket,
    dnsBuffer: dnsutil.encode(cr.dnsPacket),
  };
}
