/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import { UserCache } from "./userCache.js";
import * as util from "../../commons/util.js";
import * as dnsBlockUtil from "../dnsblockutil.js";

// TODO: determine an approp cache-size
const cacheSize = 10000;

export class UserOperation {
  constructor() {
    this.userConfigCache = new UserCache(cacheSize);
    this.log = log.withTags("UserOp");
  }

  /*
   * @param {*} param
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
      let r = this.userConfigCache.get(blocklistFlag);

      if (util.emptyObj(r)) {
        // TODO: blocklistFlag may be invalid, ref blockstampFromUrl impl
        r = dnsBlockUtil.unstamp(blocklistFlag);

        // FIXME: add to cache iff !empty(r.userBlocklistFlagUint)?
        this.log.d(param.rxid, "new cfg cache kv", blocklistFlag, r);
        // TODO: blocklistFlag is not normalized, ie b32 used for dot isn't
        // converted to its b64 form (which both doh and blocklist-wrapper use)
        // example, b32: 1-AABABAA / equivalent b64: 1:AAIAgA==
        this.userConfigCache.put(blocklistFlag, r);
      }

      response.data.userBlocklistInfo = r;
      // sets user-preferred doh upstream
      response.data.dnsResolverUrl = null;
    } catch (e) {
      this.log.e(param.rxid, "loadUser", e);
      response = util.errResponse("UserOp:loadUser", e);
    }

    return response;
  }
}
