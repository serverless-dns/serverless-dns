/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import { LocalCache as LocalCache } from "@serverless-dns/cache-wrapper";
export class UserOperation {
  constructor() {
    this.userConfigCache = false;
  }
  /**
   * @param {*} param
   * @param {*} param.blocklistFilter
   * @param {*} param.dnsResolverUrl
   * @param {*} param.request
   * @returns
   */
  async RethinkModule(param) {
    return loadUser.call(this, param);
  }
}

function loadUser(param) {
  let response = {};
  response.isException = false;
  response.exceptionStack = "";
  response.exceptionFrom = "";
  response.data = {};
  try {
    if (!this.userConfigCache) {
      this.userConfigCache = new LocalCache(
        "User-Config-Cache",
        1000
      );
    }
    let userBlocklistInfo = {};
    userBlocklistInfo.from = "Cache";
    let blocklistFlag = getBlocklistFlag(param.request.url);
    let currentUser = this.userConfigCache.Get(blocklistFlag);
    if (!currentUser) {
      currentUser = {};
      currentUser.k = blocklistFlag;
      currentUser.data = {};
      currentUser.data.userBlocklistFlagUint = "";
      currentUser.data.flagVersion = 0;
      currentUser.data.userServiceListUint = false;
      currentUser.data.isValidFlag = true;
      currentUser.data.isEmptyFlag = false;

      let response = param.blocklistFilter.userB64FlagProcess(blocklistFlag);
      currentUser.data.userBlocklistFlagUint = response.userBlocklistFlagUint;
      currentUser.data.isValidFlag = response.isValidFlag;
      currentUser.data.flagVersion = response.flagVersion;
      currentUser.data.isEmptyFlag = response.isEmptyFlag;

      if (currentUser.data.isValidFlag) {
        currentUser.data.userServiceListUint = param.blocklistFilter
          .flagIntersection(
            currentUser.data.userBlocklistFlagUint,
            param.blocklistFilter.wildCardUint,
          );
      }
      userBlocklistInfo.from = "Generated";
    }
    userBlocklistInfo.userBlocklistFlagUint =
      currentUser.data.userBlocklistFlagUint;
    userBlocklistInfo.isValidFlag = currentUser.data.isValidFlag;
    userBlocklistInfo.flagVersion = currentUser.data.flagVersion;
    userBlocklistInfo.isEmptyFlag = currentUser.data.isEmptyFlag;
    userBlocklistInfo.userServiceListUint =
      currentUser.data.userServiceListUint;
    userBlocklistInfo.dnsResolverUrl = param.dnsResolverUrl;

    response.data = userBlocklistInfo;
    this.userConfigCache.Put(currentUser);
  } catch (e) {
    response.isException = true;
    response.exceptionStack = e.stack;
    response.exceptionFrom = "UserOperation loadUser";
    response.data = false;
    console.error("Error At : UserOperation -> loadUser");
    console.error(e.stack);
  }
  return response;
}

/**
 * Get the blocklist stamp (base64 encoded) from Request URL
 * @param {String} url - Request URL string
 * @returns
 */
function getBlocklistFlag(url) {
  let blocklistFlag = "";
  let reqUrl = new URL(url);

  // Check if pathname has `/dns-query`
  let tmpsplit = reqUrl.pathname.split("/");
  if (tmpsplit.length > 1) {
    if (tmpsplit[1].toLowerCase() == "dns-query") {
      blocklistFlag = tmpsplit[2] || "";
    } else {
      blocklistFlag = tmpsplit[1] || "";
    }
  }
  return blocklistFlag;
}
