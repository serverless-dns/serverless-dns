/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import DNSParserWrap from "./dnsParserWrap.js";

export default class DNSResponseBlock {
  constructor() {
    this.dnsParser = new DNSParserWrap();
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
    response.data.isNotBlockedExistInBlocklist = false;
    response.data.domainNameInBlocklistUint;
    response.data.domainNameUserBlocklistIntersection;
    try {
      if (param.userBlocklistInfo.userBlocklistFlagUint.length > 0) {
        if (
          param.responseDecodedDnsPacket.answers.length > 0 &&
          param.responseDecodedDnsPacket.answers[0].type == "CNAME"
        ) {
          checkCnameBlock(param, response, param.responseDecodedDnsPacket);
        } else if (
          param.responseDecodedDnsPacket.answers.length > 0 &&
          (param.responseDecodedDnsPacket.answers[0].type == "HTTPS" ||
          param.responseDecodedDnsPacket.answers[0].type == "SVCB")
        ) {
          checkHttpsSvcbBlock(param, response, param.responseDecodedDnsPacket);
        }
      }
    } catch (e) {
      response.isException = true;
      response.exceptionStack = e.stack;
      response.exceptionFrom = "DNSResponseBlock RethinkModule";
      response.data = false;
      console.error("Error At : DNSResponseBlock -> RethinkModule");
      console.error(e.stack);
    }
    return response;
  }
}

function checkHttpsSvcbBlock(param, response, decodedDnsPacket) {
  let targetName = decodedDnsPacket.answers[0].data.targetName.trim()
    .toLowerCase();
  if (targetName != ".") {
    domainNameBlocklistInfo = param.blocklistFilter.getDomainInfo(
      targetName,
    );
    if (domainNameBlocklistInfo.data.searchResult) {
      response.data = checkDomainBlocking(
        param.userBlocklistInfo,
        domainNameBlocklistInfo,
        param.blocklistFilter,
        targetName,
      );
    }
  }
}
function checkCnameBlock(param, response, decodedDnsPacket) {
  let domainNameBlocklistInfo;
  let cname = decodedDnsPacket.answers[0].data.trim().toLowerCase();
  domainNameBlocklistInfo = param.blocklistFilter.getDomainInfo(
    cname,
  );
  if (domainNameBlocklistInfo.data.searchResult) {
    response.data = checkDomainBlocking(
      param.userBlocklistInfo,
      domainNameBlocklistInfo,
      param.blocklistFilter,
      cname,
    );
  }

  if (!response.data.isBlocked) {
    cname = decodedDnsPacket
      .answers[decodedDnsPacket.answers.length - 1].name.trim()
      .toLowerCase();
    domainNameBlocklistInfo = param.blocklistFilter.getDomainInfo(
      cname,
    );
    if (domainNameBlocklistInfo.data.searchResult) {
      response.data = checkDomainBlocking(
        param.userBlocklistInfo,
        domainNameBlocklistInfo,
        param.blocklistFilter,
        cname,
      );
    }
  }
}
function checkDomainBlocking(
  userBlocklistInfo,
  domainNameBlocklistInfo,
  blocklistFilter,
  domainName,
) {
  let response;
  try {
    response = checkDomainNameUserFlagIntersection(
      userBlocklistInfo.userBlocklistFlagUint,
      userBlocklistInfo.flagVersion,
      domainNameBlocklistInfo,
      blocklistFilter,
      domainName,
    );
    if (response.isBlocked) {
      return response;
    }

    if (userBlocklistInfo.userServiceListUint) {
      let dnSplit = domainName.split(".");
      let dnJoin = "";
      let wildCardResponse;
      while (dnSplit.shift() != undefined) {
        dnJoin = dnSplit.join(".");
        wildCardResponse = checkDomainNameUserFlagIntersection(
          userBlocklistInfo.userServiceListUint,
          userBlocklistInfo.flagVersion,
          domainNameBlocklistInfo,
          blocklistFilter,
          dnJoin,
        );
        if (wildCardResponse.isBlocked) {
          return wildCardResponse;
        }
      }
    }
  } catch (e) {
    throw e;
  }

  return response;
}

function checkDomainNameUserFlagIntersection(
  userBlocklistFlagUint,
  flagVersion,
  domainNameBlocklistInfo,
  blocklistFilter,
  domainName,
) {
  let response = {};
  try {
    response.isBlocked = false;
    response.isNotBlockedExistInBlocklist = false;
    response.blockedB64Flag = "";
    response.blockedTag = [];
    if (domainNameBlocklistInfo.data.searchResult.has(domainName)) {
      let domainNameInBlocklistUint = domainNameBlocklistInfo.data.searchResult
        .get(domainName);
      let blockedUint = blocklistFilter.flagIntersection(
        userBlocklistFlagUint,
        domainNameInBlocklistUint,
      );
      if (blockedUint) {
        response.isBlocked = true;
        response.blockedB64Flag = blocklistFilter.getB64FlagFromUint16(
          blockedUint,
          flagVersion,
        );
      } else {
        response.isNotBlockedExistInBlocklist = true;
        blockedUint = new Uint16Array(domainNameInBlocklistUint.length);
        let index = 0;
        for (let singleBlock of domainNameInBlocklistUint) {
          blockedUint[index] = singleBlock;
          index++;
        }
        response.blockedB64Flag = blocklistFilter.getB64FlagFromUint16(
          blockedUint,
          flagVersion,
        );
      }
      response.blockedTag = blocklistFilter.getTag(blockedUint);
    }
  } catch (e) {
    throw e;
  }
  return response;
}
