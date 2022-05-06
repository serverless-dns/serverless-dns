/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import { UserCache } from "./user-cache.js";
import * as util from "../../commons/util.js";
import * as rdnsutil from "../rdns-util.js";

// TODO: determine an approp cache-size
const cacheSize = 10000;

export class UserOp {
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
      const blocklistFlag = rdnsutil.blockstampFromUrl(param.request.url);

      if (util.emptyString(blocklistFlag)) {
        this.log.d(param.rxid, "empty blocklist-flag", param.request.url);
      }

      // blocklistFlag may be invalid, ref rdnsutil.blockstampFromUrl
      let r = this.userConfigCache.get(blocklistFlag);
      if (!util.emptyString(blocklistFlag) && util.emptyObj(r)) {
        r = rdnsutil.unstamp(blocklistFlag);

        // FIXME: add to cache iff !empty(r.userBlocklistFlagUint)?
        this.log.d(param.rxid, "new cfg cache kv", blocklistFlag, r);
        // TODO: blocklistFlag is not normalized, ie b32 used for dot isn't
        // converted to its b64 form (which doh and rethinkdns modules use)
        // example, b32: 1-AABABAA / equivalent b64: 1:AAIAgA==
        this.userConfigCache.put(blocklistFlag, r);
      } else {
        this.log.d(param.rxid, "cfg cache hit?", r != null, blocklistFlag, r);
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
