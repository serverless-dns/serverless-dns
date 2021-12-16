/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import { LocalCache as LocalCache } from "../cache-wrapper/cache-wrapper.js";
import { BlocklistFilter } from "../blocklist-wrapper/blocklistWrapper.js";

export class UserOperation {
  constructor() {
    this.userConfigCache = false;
    this.blocklistFilter = new BlocklistFilter();
  }
  /**
   * @param {*} param
   * @param {*} param.dnsResolverUrl
   * @param {*} param.request
   * @param {*} param.isDnsMsg
   * @returns
   */
  async RethinkModule(param) {
    return this.loadUser(param);
  }
  
  loadUser(param) {
    let response = {};
    response.isException = false;
    response.exceptionStack = "";
    response.exceptionFrom = "";
    response.data = {};
    response.data.userBlocklistInfo = {};
    response.data.userBlocklistInfo.dnsResolverUrl = "";
    try {
      if (!param.isDnsMsg) {
        return response;
      }

      if (!this.userConfigCache) {
        this.userConfigCache = new LocalCache(
          "User-Config-Cache",
          1000,
        );
      }
      let userBlocklistInfo = {};
      userBlocklistInfo.from = "Cache";
      let blocklistFlag = getBlocklistFlag(param.request.url);
      let currentUser = this.userConfigCache.Get(blocklistFlag);
      if (!currentUser) {
        currentUser = {};
        currentUser.userBlocklistFlagUint = "";
        currentUser.flagVersion = 0;
        currentUser.userServiceListUint = false;

        let response = this.blocklistFilter.unstamp(blocklistFlag);
        currentUser.userBlocklistFlagUint = response.userBlocklistFlagUint;
        currentUser.flagVersion = response.flagVersion;

        if (currentUser.userBlocklistFlagUint !== "") {
          currentUser.userServiceListUint = this.blocklistFilter
            .flagIntersection(
              currentUser.userBlocklistFlagUint,
              this.blocklistFilter.wildCardUint,
            );
        } else {
          blocklistFlag = "";
        }
        userBlocklistInfo.from = "Generated";
        this.userConfigCache.Put(blocklistFlag, currentUser);
      }
      userBlocklistInfo.userBlocklistFlagUint =
        currentUser.userBlocklistFlagUint;
      userBlocklistInfo.flagVersion = currentUser.flagVersion;
      userBlocklistInfo.userServiceListUint = currentUser.userServiceListUint;

      response.data.userBlocklistInfo = userBlocklistInfo;
      response.data.dnsResolverUrl = param.dnsResolverUrl;
    } catch (e) {
      response.isException = true;
      response.exceptionStack = e.stack;
      response.exceptionFrom = "UserOperation loadUser";
      console.error("Error At : UserOperation -> loadUser");
      console.error(e.stack);
    }
    return response;
  }
}
/**
 * Get the blocklist flag from `Request` URL
 * DNS over TLS flag from SNI should be rewritten to `url`'s pathname
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
