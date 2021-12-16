/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import DNSParserWrap from "./dnsParserWrap.js";
import DNSBlockOperation from "./dnsBlockOperation.js";

export default class DNSBlock {
  constructor() {
    this.dnsParser = new DNSParserWrap();
    this.dnsBlockOperation = new DNSBlockOperation();
    this.wCache = null;
  }
  /**
   * @param {*} param
   * @param {*} param.userBlocklistInfo
   * @param {*} param.blocklistFilter
   * @param {*} param.requestDecodedDnsPacket
   * @param {*} param.isAggCacheReq
   * @param {*} param.event
   * @param {*} param.request
   * @returns
   */
  async RethinkModule(param) {
    let response = {};
    response.isException = false;
    response.exceptionStack = "";
    response.exceptionFrom = "";
    response.data = {};
    response.data.isBlocked = false;
    response.data.blockedB64Flag = "";
    try {
      if (param.userBlocklistInfo.userBlocklistFlagUint.length !== "") {
        let domainNameBlocklistInfo;
        // FIXME: handle HTTPS/SVCB
        if (
          (param.requestDecodedDnsPacket.questions.length >= 1) &&
          (param.requestDecodedDnsPacket.questions[0].type == "A" ||
            param.requestDecodedDnsPacket.questions[0].type == "AAAA" ||
            param.requestDecodedDnsPacket.questions[0].type == "CNAME" ||
            param.requestDecodedDnsPacket.questions[0].type == "HTTPS" ||
            param.requestDecodedDnsPacket.questions[0].type == "SVCB")
        ) {
          domainNameBlocklistInfo = param.blocklistFilter.getDomainInfo(
            param.requestDecodedDnsPacket.questions[0].name,
          );
          if (domainNameBlocklistInfo.searchResult) {
            response.data = this.dnsBlockOperation.checkDomainBlocking(
              param.userBlocklistInfo.userBlocklistFlagUint,
              param.userBlocklistInfo.userServiceListUint,
              param.userBlocklistInfo.flagVersion,
              domainNameBlocklistInfo.searchResult,
              param.blocklistFilter,
              param.requestDecodedDnsPacket.questions[0].name,
            );
            if (response.data.isBlocked && param.isAggCacheReq) {
              if (this.wCache === null) {
                this.wCache = caches.default;
              }
              toCacheApi(param, this.wCache, domainNameBlocklistInfo);
            }
          }
        }
      }
    } catch (e) {
      response.isException = true;
      response.exceptionStack = e.stack;
      response.exceptionFrom = "DNSBlock RethinkModule";
      console.error("Error At : DNSBlock -> RethinkModule");
      console.error(e.stack);
    }
    return response;
  }
}

function toCacheApi(param, wCache, domainNameBlocklistInfo) {
  const dn =
    param.requestDecodedDnsPacket.questions[0].name.trim().toLowerCase() + ":" +
    param.requestDecodedDnsPacket.questions[0].type;
  let wCacheUrl = new URL((new URL(param.request.url)).origin + "/" + dn);
  let response = new Response("", {
    headers: {
      "x-rethink-metadata": JSON.stringify({
        ttlEndTime: 0,
        bodyUsed: false,
        blocklistInfo: Object.fromEntries(domainNameBlocklistInfo.searchResult),
      }),
    },
    cf: { cacheTtl: 604800 }, //setting ttl to 7days 60*60*24*7
  });
  param.event.waitUntil(wCache.put(wCacheUrl, response));
}
