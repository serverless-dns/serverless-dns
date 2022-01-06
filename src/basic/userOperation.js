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

// TODO: determine an approp cache-size
const cacheSize = 10000;

export class UserOperation {
  constructor() {
    this.userConfigCache = new UserCache(cacheSize);
    this.log = log.withTags("UserOp");
  }

  /*
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
    let response = util.emptyResponse();

    if (!param.isDnsMsg) {
      this.log.w(param.rxid, "not a dns-msg, ignore");
      return response;
    }

    try {
      const blocklistFlag = dnsBlockUtil.blockstampFromUrl(param.request.url);
      let currentUser = this.userConfigCache.get(blocklistFlag);

      if (util.emptyObj(currentUser)) {
        const r = dnsBlockUtil.unstamp(blocklistFlag);

        const serviceListUint = dnsBlockUtil.flagIntersection(
          r.userBlocklistFlagUint,
          dnsBlockUtil.wildcards()
        );

        currentUser = {
          userBlocklistFlagUint: r.userBlocklistFlagUint,
          flagVersion: r.flagVersion,
          userServiceListUint: serviceListUint,
        };

        // FIXME: add to cache iff !empty(currentUser.userBlocklistFlagUint)?
        this.log.d(param.rxid, "new cfg cache kv", blocklistFlag, currentUser);
        // TODO: blocklistFlag is not normalized, ie b32 used for dot isn't
        // converted to its b64 form (which both doh and blocklist-wrapper use)
        // example, b32: 1-AABABAA / equivalent b64: 1:AAIAgA==
        this.userConfigCache.put(blocklistFlag, currentUser);
      }

      response.data.userBlocklistInfo = currentUser;
      response.data.dnsResolverUrl = param.dnsResolverUrl;
    } catch (e) {
      this.log.e(param.rxid, "loadUser", e);
      response = util.errResponse("UserOp:loadUser", e);
    }

    return response;
  }
}
