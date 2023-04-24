/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import { UserCache } from "./user-cache.js";
import * as pres from "../plugin-response.js";
import * as util from "../../commons/util.js";
import * as rdnsutil from "../rdns-util.js";
import * as token from "./auth-token.js";
import * as bufutil from "../../commons/bufutil.js";

// TODO: determine an approp cache-size
const cacheSize = 20000;

export class UserOp {
  constructor() {
    this.userConfigCache = new UserCache(cacheSize);
    this.log = log.withTags("UserOp");
  }

  /**
   * @param {{request: Request, isDnsMsg: Boolean, rxid: string}} ctx
   * @returns {Promise<pres.RResp>}
   */
  async exec(ctx) {
    let res = pres.emptyResponse();

    try {
      const out = await token.auth(ctx.rxid, ctx.request.url);
      if (!out.ok) {
        res = pres.errResponse("UserOp:Auth", new Error("auth failed"));
      } else {
        res = this.loadUser(ctx);
      }
      res.data.userAuth = out;
    } catch (ex) {
      res = pres.errResponse("UserOp", ex);
    }

    return res;
  }

  /**
   * @param {{request: Request, isDnsMsg: Boolean, rxid: string}} ctx
   * @returns {pres.RResp}
   */
  loadUser(ctx) {
    let response = pres.emptyResponse();

    if (!ctx.isDnsMsg) {
      this.log.w(ctx.rxid, "not a dns-msg, ignore");
      return response;
    }

    try {
      const blocklistFlag = rdnsutil.blockstampFromUrl(ctx.request.url);

      if (util.emptyString(blocklistFlag)) {
        this.log.d(ctx.rxid, "empty blocklist-flag", ctx.request.url);
      }

      // blocklistFlag may be invalid, ref rdnsutil.blockstampFromUrl
      let r = this.userConfigCache.get(blocklistFlag);
      if (!util.emptyString(blocklistFlag) && util.emptyObj(r)) {
        r = rdnsutil.unstamp(blocklistFlag);

        if (!bufutil.emptyBuf(r.userBlocklistFlagUint)) {
          this.log.d(ctx.rxid, "new cfg cache kv", blocklistFlag, r);
          // TODO: blocklistFlag is not normalized, ie b32 used for dot isn't
          // converted to its b64 form (which doh and rethinkdns modules use)
          // example, b32: 1-AABABAA / equivalent b64: 1:AAIAgA==
          this.userConfigCache.put(blocklistFlag, r);
        }
      } else {
        this.log.d(ctx.rxid, "cfg cache hit?", r != null, blocklistFlag, r);
      }

      response.data.userBlocklistInfo = r;
      response.data.userBlocklistFlag = blocklistFlag;
      // sets user-preferred doh upstream
      response.data.dnsResolverUrl = null;
    } catch (e) {
      this.log.e(ctx.rxid, "loadUser", e);
      response = pres.errResponse("UserOp:loadUser", e);
    }

    return response;
  }
}
