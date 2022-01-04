/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import { UserCache } from "../cache-wrapper/cache-wrapper.js";
import { BlocklistFilter } from "../blocklist-wrapper/blocklistWrapper.js";
import * as util from "../helpers/util.js";
import * as dnsBlockUtil from "../helpers/dnsblockutil.js";

export class UserOperation {
  constructor() {
    this.userConfigCache = new UserCache(1000);
    this.blocklistFilter = new BlocklistFilter();
    this.log = log.withTags("UserOp");
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
    const response = {};
    response.isException = false;
    response.exceptionStack = "";
    response.exceptionFrom = "";
    response.data = {};
    response.data.userBlocklistInfo = {};
    response.data.userBlocklistInfo.dnsResolverUrl = "";

    if (!param.isDnsMsg) {
      return response;
    }

    try {
      const userBlocklistInfo = {};
      let blocklistFlag = getBlocklistFlag(param.request.url);
      let currentUser = this.userConfigCache.get(blocklistFlag);

      if (util.emptyObj(currentUser)) {
        currentUser = {};
        currentUser.userBlocklistFlagUint = "";
        currentUser.flagVersion = 0;
        currentUser.userServiceListUint = false;

        const response = this.blocklistFilter.unstamp(blocklistFlag);
        currentUser.userBlocklistFlagUint = response.userBlocklistFlagUint;
        currentUser.flagVersion = response.flagVersion;

        if (!util.emptyString(currentUser.userBlocklistFlagUint)) {
          currentUser.userServiceListUint = dnsBlockUtil.flagIntersection(
            currentUser.userBlocklistFlagUint,
            this.blocklistFilter.wildCardUint
          );
        } else {
          blocklistFlag = "";
        }
        userBlocklistInfo.from = "Generated";
        // FIXME: blocklistFlag can be an empty-string
        this.userConfigCache.put(blocklistFlag, currentUser);
      } else {
        userBlocklistInfo.from = "Cache";
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
      this.log.e(param.rxid, "loadUser", e);
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
  const reqUrl = new URL(url);

  // Check if pathname has `/dns-query`
  const tmpsplit = reqUrl.pathname.split("/");
  if (tmpsplit.length > 1) {
    if (tmpsplit[1].toLowerCase() === "dns-query") {
      blocklistFlag = tmpsplit[2] || "";
    } else {
      blocklistFlag = tmpsplit[1] || "";
    }
  }
  return blocklistFlag;
}
