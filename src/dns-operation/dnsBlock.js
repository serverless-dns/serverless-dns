/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import DNSBlockOperation from "./dnsBlockOperation.js";
import * as util from "../helpers/util.js";

export default class DNSBlock {
  constructor() {
    this.dnsBlockOperation = new DNSBlockOperation();
  }
  /**
   * @param {*} param
   * @param {*} param.userBlocklistInfo
   * @param {*} param.blocklistFilter
   * @param {*} param.requestDecodedDnsPacket
   * @param {*} param.isAggCacheReq
   * @param {*} param.event
   * @param {*} param.request
   * @param {*} param.dnsCache
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
      if (hasBlocklistStamp(param)) {
        let domainNameBlocklistInfo;
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
              console.debug("blocked dns response add to cache api")
              toCacheApi(param, domainNameBlocklistInfo);
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

function hasBlocklistStamp(param) {
  return param &&
    param.userBlocklistInfo &&
    !util.emptyString(param.userBlocklistInfo.userBlocklistFlagUint);
}

function toCacheApi(param, domainNameBlocklistInfo) {
  const dn =
    param.requestDecodedDnsPacket.questions[0].name.trim().toLowerCase() + ":" +
    param.requestDecodedDnsPacket.questions[0].type;
  let metaData = {
    ttlEndTime: 0,
    bodyUsed: false,
    blocklistInfo: Object.fromEntries(domainNameBlocklistInfo.searchResult),
  };
  param.event.waitUntil(
    param.dnsCache.putCacheApi(key, param.request.url, "", metaData),
  );
}
