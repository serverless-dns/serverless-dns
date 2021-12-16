/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import DNSBlockOperation from "./dnsBlockOperation.js";

export default class DNSResponseBlock {
  constructor() {
    this.dnsBlockOperation = new DNSBlockOperation();
  }
  /**
   * @param {*} param
   * @param {*} param.userBlocklistInfo
   * @param {*} param.blocklistFilter
   * @param {DnsDecodedObject} param.responseDecodedDnsPacket
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
      if (param.userBlocklistInfo.userBlocklistFlagUint !== "") {
        if (
          param.responseDecodedDnsPacket.answers.length > 0 &&
          param.responseDecodedDnsPacket.answers[0].type == "CNAME"
        ) {
          checkCnameBlock(param, response, this.dnsBlockOperation);
        } else if (
          param.responseDecodedDnsPacket.answers.length > 0 &&
          (param.responseDecodedDnsPacket.answers[0].type == "HTTPS" ||
            param.responseDecodedDnsPacket.answers[0].type == "SVCB")
        ) {
          checkHttpsSvcbBlock(param, response, this.dnsBlockOperation);
        }
      }
    } catch (e) {
      response.isException = true;
      response.exceptionStack = e.stack;
      response.exceptionFrom = "DNSResponseBlock RethinkModule";
      console.error("Error At : DNSResponseBlock -> RethinkModule");
      console.error(e.stack);
    }
    return response;
  }
}

function checkHttpsSvcbBlock(
  param,
  response,
  dnsBlockOperation,
) {
  let targetName = param.responseDecodedDnsPacket.answers[0].data.targetName.trim()
    .toLowerCase();
  if (targetName != ".") {
    let domainNameBlocklistInfo = param.blocklistFilter.getDomainInfo(
      targetName,
    );
    if (domainNameBlocklistInfo.searchResult) {
      response.data = dnsBlockOperation.checkDomainBlocking(
        param.userBlocklistInfo.userBlocklistFlagUint,
        param.userBlocklistInfo.userServiceListUint,
        param.userBlocklistInfo.flagVersion,
        domainNameBlocklistInfo.searchResult,
        param.blocklistFilter,
        targetName
      );
    }
  }
}
function checkCnameBlock(param, response, dnsBlockOperation) {
  let cname = param.responseDecodedDnsPacket.answers[0].data.trim().toLowerCase();
  let domainNameBlocklistInfo = param.blocklistFilter.getDomainInfo(
    cname,
  );
  if (domainNameBlocklistInfo.searchResult) {
    response.data = dnsBlockOperation.checkDomainBlocking(
      param.userBlocklistInfo.userBlocklistFlagUint,
      param.userBlocklistInfo.userServiceListUint,
      param.userBlocklistInfo.flagVersion,
      domainNameBlocklistInfo.searchResult,
      param.blocklistFilter,
      cname
    );
  }

  if (!response.data.isBlocked) {
    cname = param.responseDecodedDnsPacket
      .answers[param.responseDecodedDnsPacket.answers.length - 1].name.trim()
      .toLowerCase();
    domainNameBlocklistInfo = param.blocklistFilter.getDomainInfo(
      cname,
    );
    if (domainNameBlocklistInfo.searchResult) {
      response.data = dnsBlockOperation.checkDomainBlocking(
        param.userBlocklistInfo.userBlocklistFlagUint,
        param.userBlocklistInfo.userServiceListUint,
        param.userBlocklistInfo.flagVersion,
        domainNameBlocklistInfo.searchResult,
        param.blocklistFilter,
        cname
      );
    }
  }
}
