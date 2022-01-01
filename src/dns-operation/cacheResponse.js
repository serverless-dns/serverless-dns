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
  constructor() {}

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
      console.error("Error At : DNSAggCache -> RethinkModule");
      console.error(e.stack);
    }
    return response;
  }

  async resolveFromCache(param) {
    const key = cacheutil.cacheKey(param.requestDecodedDnsPacket);
    if (!key) return false;
    const cacheResponse = await param.dnsCache.get(key, param.request.url);
    console.debug("cache key : ", key);
    console.debug("Cache Response", JSON.stringify(cacheResponse));
    if (!cacheResponse) return false;
    return await parseCacheResponse(
      cacheResponse,
      param.userBlocklistInfo,
      param.requestDecodedDnsPacket,
      param.dnsQuestionBlock,
      param.dnsResponseBlock
    );
  }
}

async function parseCacheResponse(cr, blockInfo, reqDnsPacket, qb, rb) {
  // check dns-block for incoming request against blocklist metadata from cache
  let response = checkDnsBlock(
    qb,
    reqDnsPacket,
    cr.metaData.cacheFilter,
    blockInfo
  );
  console.debug("question block ", JSON.stringify(response));
  if (response && response.isBlocked) {
    return response;
  }
  // cache response contains only metadata information
  // return false to resolve dns request.
  if (!cr.metaData.bodyUsed) {
    return false;
  }

  // answer block check
  response = checkDnsBlock(
    rb,
    cr.dnsPacket,
    cr.metaData.cacheFilter,
    blockInfo
  );

  console.debug("answer block ", JSON.stringify(response));
  if (response && response.isBlocked) {
    return response;
  }

  response = generateResponse(cr, reqDnsPacket.id);

  return response;
}

function checkDnsBlock(qb, dnsPacket, cf, blockInfo) {
  return qb.performBlocking(blockInfo, dnsPacket, false, cf);
}

function generateResponse(cr, qid) {
  const response = {};
  response.dnsPacket = cr.dnsPacket;

  cacheutil.updateQueryId(response.dnsPacket, qid);
  cacheutil.updateTtl(response.dnsPacket, cr.metaData.ttlEndTime);

  response.dnsBuffer = dnsutil.encode(response.dnsPacket);

  return response;
}
