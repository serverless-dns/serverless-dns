/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

export default class DNSBlockOperation {
  checkDomainBlocking(
    userBlocklistFlagUint,
    userServiceListUint,
    flagVersion,
    blocklistMap,
    blocklistFilter,
    domainName,
  ) {
    let response;
    try {
      response = checkDomainNameUserFlagIntersection(
        userBlocklistFlagUint,
        flagVersion,
        blocklistMap,
        blocklistFilter,
        domainName,
      );
      if (response.isBlocked) {
        return response;
      }

      if (userServiceListUint) {
        let dnSplit = domainName.split(".");
        let dnJoin = "";
        let wildCardResponse;
        while (dnSplit.shift() != undefined) {
          dnJoin = dnSplit.join(".");
          wildCardResponse = checkDomainNameUserFlagIntersection(
            userServiceListUint,
            flagVersion,
            blocklistMap,
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
}

function checkDomainNameUserFlagIntersection(
    userBlocklistFlagUint,
    flagVersion,
    blocklistMap,
    blocklistFilter,
    domainName,
  ) {
    let response = {};
    try {
      response.isBlocked = false;
      response.blockedB64Flag = "";
      response.blockedTag = [];
      if (blocklistMap.has(domainName)) {
        let domainNameInBlocklistUint = blocklistMap.get(domainName);
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
          blockedUint = new Uint16Array(domainNameInBlocklistUint);
          response.blockedB64Flag = blocklistFilter.getB64FlagFromUint16(
            blockedUint,
            flagVersion,
          );
        }
        //response.blockedTag = blocklistFilter.getTag(blockedUint);
      }
    } catch (e) {
      throw e;
    }
    return response;
  }