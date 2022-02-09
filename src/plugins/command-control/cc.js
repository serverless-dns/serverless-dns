/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as envutil from "../../commons/envutil.js";
import * as util from "../../commons/util.js";
import * as rdnsutil from "../dnsblockutil.js";

export class CommandControl {
  constructor(blocklistWrapper) {
    this.latestTimestamp = envutil.timestamp();
    this.log = log.withTags("CommandControl");
    this.bw = blocklistWrapper;
  }

  /**
   * @param {Object} param
   * @param {Request} param.request
   * @param {String | Number} param.latestTimestamp
   * @param {Boolean} param.isDnsMsg
   * @returns
   */
  async RethinkModule(param) {
    // process only GET requests, ignore all others
    if (util.isGetRequest(param.request)) {
      return await this.commandOperation(
        param.rxid,
        param.request.url,
        param.isDnsMsg
      );
    }

    // no-op
    return util.emptyResponse();
  }

  isConfigureCmd(s) {
    return s === "configure" || s === "config";
  }

  isDohGetRequest(queryString) {
    return queryString && queryString.has("dns");
  }

  userFlag(url, isDnsCmd = false) {
    const emptyFlag = "";
    const p = url.pathname.split("/"); // ex: max.rethinkdns.com/cmd/XYZ
    const d = url.host.split("."); // ex: XYZ.max.rethinkdns.com

    // "configure" cmd, blockstamp (userFlag) must be at p[2]
    if (this.isConfigureCmd(p[1])) {
      return p.length >= 3 ? p[2] : emptyFlag;
    }

    // Redirect to the configure webpage when _no commands_ are set.
    // This happens when user clicks, say XYZ.max.rethinkdns.com or
    // max.rethinkdns.com/XYZ and it opens in a browser.

    // When incoming request is a dns-msg, all cmds are no-op
    if (isDnsCmd) return emptyFlag;

    // has path, possibly doh
    if (p[1]) return p[1]; // ex: max.rethinkdns.com/XYZ

    // no path, possibly dot
    return d.length > 1 ? d[0] : emptyFlag;
  }

  async commandOperation(rxid, url, isDnsMsg) {
    let response = util.emptyResponse();

    try {
      const reqUrl = new URL(url);
      const queryString = reqUrl.searchParams;
      const pathSplit = reqUrl.pathname.split("/");

      // FIXME: isDohGetRequest is redundant, simply trust isDnsMsg as-is
      const isDnsCmd = isDnsMsg || this.isDohGetRequest(queryString);

      if (isDnsCmd) {
        response.data.stopProcessing = false;
        return response;
      } else {
        // non-dns GET requests are exclusively handled here
        // and have to return a httpResponse obj
        response.data.stopProcessing = true;
      }

      const command = pathSplit[1];
      const b64UserFlag = this.userFlag(reqUrl, isDnsCmd);

      this.log.d(rxid, "processing...", url, command, b64UserFlag);

      // blocklistFilter may not to have been setup, so set it up
      await this.bw.init(rxid);
      const blf = this.bw.getBlocklistFilter();
      const isBlfSetup = rdnsutil.isBlocklistFilterSetup(blf);

      if (!isBlfSetup) throw new Error("no blocklist-filter");

      if (command === "listtob64") {
        response.data.httpResponse = listToB64(queryString, blf);
      } else if (command === "b64tolist") {
        response.data.httpResponse = b64ToList(queryString, blf);
      } else if (command === "dntolist") {
        response.data.httpResponse = domainNameToList(
          queryString,
          blf,
          this.latestTimestamp
        );
      } else if (command === "dntouint") {
        response.data.httpResponse = domainNameToUint(queryString, blf);
      } else if (command === "config" || command === "configure" || !isDnsCmd) {
        response.data.httpResponse = configRedirect(
          b64UserFlag,
          reqUrl.origin,
          this.latestTimestamp,
          !isDnsCmd
        );
      } else {
        this.log.w(rxid, "unknown command-control query");
        response.data.httpResponse = util.respond400();
      }
    } catch (e) {
      this.log.e(rxid, "err cc:op", e.stack);
      response = util.errResponse("cc:op", e);
      // TODO: set response status to 5xx
      response.data.httpResponse = jsonResponse(e.stack);
    }

    return response;
  }
}

function isRethinkDns(hostname) {
  return hostname.indexOf("rethinkdns") >= 0;
}

function configRedirect(userFlag, origin, timestamp, highlight) {
  const u = "https://rethinkdns.com/configure";
  let q = "?tstamp=" + timestamp;
  q += !isRethinkDns(origin) ? "&v=ext&u=" + origin : "";
  q += highlight ? "&s=added" : "";
  q += userFlag ? "#" + userFlag : "";
  return Response.redirect(u + q, 302);
}

function domainNameToList(queryString, blocklistFilter, latestTimestamp) {
  const domainName = queryString.get("dn") || "";
  const r = {
    domainName: domainName,
    version: latestTimestamp,
    list: {},
    listDetail: {},
  };

  const searchResult = blocklistFilter.lookup(domainName);
  if (!searchResult) {
    return jsonResponse(r);
  }

  for (const entry of searchResult) {
    const list = blocklistFilter.getTag(entry[1]);
    const listDetail = {};
    for (const listValue of list) {
      listDetail[listValue] = blocklistFilter.blocklistFileTag[listValue];
    }
    r.list[entry[0]] = listDetail;
  }

  return jsonResponse(r);
}

function domainNameToUint(queryString, blocklistFilter) {
  const domainName = queryString.get("dn") || "";
  const r = {
    domainName: domainName,
    list: {},
  };

  const searchResult = blocklistFilter.lookup(domainName);
  if (!searchResult) {
    return jsonResponse(r);
  }

  for (const entry of searchResult) {
    r.list[entry[0]] = entry[1];
  }

  return jsonResponse(r);
}

function listToB64(queryString, blocklistFilter) {
  const list = queryString.get("list") || [];
  const flagVersion = queryString.get("flagversion") || "0";
  const tags = list.split(",");

  const r = {
    command: "List To B64String",
    inputList: list,
    flagVersion: flagVersion,
    b64String: blocklistFilter.getB64FlagFromTag(tags, flagVersion),
  };

  return jsonResponse(r);
}

function b64ToList(queryString, blocklistFilter) {
  const b64 = queryString.get("b64") || "";
  const r = {
    command: "Base64 To List",
    inputB64: b64,
    list: [],
    listDetail: {},
  };

  const stamp = rdnsutil.unstamp(b64);
  if (!rdnsutil.hasBlockstamp(stamp)) {
    return jsonResponse(r);
  }

  r.list = blocklistFilter.getTag(stamp.userBlocklistFlagUint);
  for (const listValue of r.list) {
    r.listDetail[listValue] = blocklistFilter.blocklistFileTag[listValue];
  }

  return jsonResponse(r);
}

function jsonResponse(obj) {
  return new Response(JSON.stringify(obj), { headers: util.jsonHeaders() });
}
