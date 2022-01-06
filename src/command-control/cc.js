/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as util from "../helpers/util.js";
import * as dnsBlockUtil from "../helpers/dnsblockutil.js";

export class CommandControl {
  constructor() {
    this.latestTimestamp = "";
  }

  /**
   * @param {Object} param
   * @param {Request} param.request
   * @param {*} param.blocklistFilter
   * @param {String | Number} param.latestTimestamp
   * @param {Boolean} param.isDnsMsg
   * @returns
   */
  async RethinkModule(param) {
    // TODO: latestTimestamp and other such params can be fetched from env
    this.latestTimestamp = param.latestTimestamp;

    // process only GET requests, ignore all others
    if (util.isGetRequest(param.request)) {
      return this.commandOperation(
        param.request.url,
        param.blocklistFilter,
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

  commandOperation(url, blocklistFilter, isDnsMsg) {
    let response = util.emptyResponse();

    try {
      const reqUrl = new URL(url);
      const queryString = reqUrl.searchParams;
      const pathSplit = reqUrl.pathname.split("/");

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

      if (command === "listtob64") {
        response.data.httpResponse = listToB64(queryString, blocklistFilter);
      } else if (command === "b64tolist") {
        response.data.httpResponse = b64ToList(queryString, blocklistFilter);
      } else if (command === "dntolist") {
        response.data.httpResponse = domainNameToList(
          queryString,
          blocklistFilter,
          this.latestTimestamp
        );
      } else if (command === "dntouint") {
        response.data.httpResponse = domainNameToUint(
          queryString,
          blocklistFilter
        );
      } else if (command === "config" || command === "configure" || !isDnsCmd) {
        response.data.httpResponse = configRedirect(
          b64UserFlag,
          reqUrl.origin,
          this.latestTimestamp,
          !isDnsCmd
        );
      } else {
        response.data.httpResponse = util.respond400();
      }
    } catch (e) {
      response = util.errResponse("cc:op", e);
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
  };

  const searchResult = blocklistFilter.hadDomainName(domainName);
  if (!searchResult) {
    r.list = false;
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

  const searchResult = blocklistFilter.hadDomainName(domainName);
  if (!searchResult) {
    r.list = false;
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
  };

  const stamp = dnsBlockUtil.unstamp(b64);
  if (stamp.userBlocklistFlagUint.length <= 0) {
    r.list = "Invalid B64 String";
    return jsonResponse(r);
  }

  r.list = blocklistFilter.getTag(stamp.userBlocklistFlagUint);
  r.listDetail = {};
  for (const listValue of r.list) {
    r.listDetail[listValue] = blocklistFilter.blocklistFileTag[listValue];
  }

  return jsonResponse(r);
}

function jsonResponse(obj) {
  return new Response(JSON.stringify(obj), { headers: util.jsonHeaders() });
}
