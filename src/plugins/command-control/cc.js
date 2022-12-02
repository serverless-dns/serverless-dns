/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as cfg from "../../core/cfg.js";
import * as util from "../../commons/util.js";
import * as rdnsutil from "../rdns-util.js";
import { flagsToTags, tagsToFlags } from "@serverless-dns/trie/stamp.js";
import { BlocklistFilter } from "../rethinkdns/filter.js";

export class CommandControl {
  constructor(blocklistWrapper) {
    this.latestTimestamp = rdnsutil.bareTimestampFrom(cfg.timestamp());
    this.log = log.withTags("CommandControl");
    this.bw = blocklistWrapper;
    this.cmds = new Set([
      "configure",
      "config",
      "search",
      "dntolist",
      "dntouint",
      "listtob64",
      "b64tolist",
    ]);
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

  isAnyCmd(s) {
    return this.cmds.has(s);
  }

  userCommands(url) {
    const emptyCmd = ["", ""];
    // r.x/a/b/c/ => ["", "a", "b", "c", ""]
    // abc.r.x/a => ["", "a"]
    const p = url.pathname.split("/");

    if (!p || p.length <= 1) return emptyCmd;

    const last = p[p.length - 1];
    const first = p[1]; // may equal last

    return [first, last];
  }

  userFlag(url, isDnsCmd = false) {
    const emptyFlag = "";
    const p = url.pathname.split("/"); // ex: max.rethinkdns.com/cmd/XYZ
    const d = url.host.split("."); // ex: XYZ.max.rethinkdns.com

    // if cmd is at p[1], blockstamp (userFlag) must be at p[2]
    if (this.isAnyCmd(p[1])) {
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
    return d.length > 1 ? d[0] : emptyFlag; // ex: XYZ.max.rethinkdns.com
  }

  async commandOperation(rxid, url, isDnsCmd) {
    let response = util.emptyResponse();

    try {
      const reqUrl = new URL(url);
      const queryString = reqUrl.searchParams;

      if (isDnsCmd) {
        this.log.d(rxid, "cc no-op: dns-msg not cc-msg");
        response.data.stopProcessing = false;
        return response;
      } else {
        // non-dns GET requests are exclusively handled here
        // and have to return a httpResponse obj
        response.data.stopProcessing = true;
      }

      const [cmd1, cmd2] = this.userCommands(reqUrl, isDnsCmd);
      const b64UserFlag = this.userFlag(reqUrl, isDnsCmd);
      // if userflag is same as cmd1, then cmd2 must be the actual cmd
      // consider urls: r.tld/cmd/flag & r.tld/flag/cmd
      // by default, treat cmd1 (at path[1]) as cmd, regardless
      const command = this.isAnyCmd(cmd2) ? cmd2 : cmd1;

      this.log.d(rxid, url, "processing... cmd/flag", command, b64UserFlag);

      // blocklistFilter may not to have been setup, so set it up
      await this.bw.init(rxid);
      const blf = this.bw.getBlocklistFilter();
      const isBlfSetup = rdnsutil.isBlocklistFilterSetup(blf);

      if (!isBlfSetup) throw new Error("no blocklist-filter");

      if (command === "listtob64") {
        // convert blocklists (tags) to blockstamp (b64)
        response.data.httpResponse = listToB64(queryString);
      } else if (command === "b64tolist") {
        // convert blockstamp (b64) to blocklists (tags)
        response.data.httpResponse = b64ToList(queryString, blf);
      } else if (command === "dntolist") {
        // convert names to blocklists (tags)
        response.data.httpResponse = domainNameToList(
          queryString,
          blf,
          this.latestTimestamp
        );
      } else if (command === "dntouint") {
        // convert names to flags
        response.data.httpResponse = domainNameToUint(queryString, blf);
      } else if (command === "search") {
        // redirect to the search page with blockstamp (b64) preloaded
        response.data.httpResponse = searchRedirect(b64UserFlag);
      } else if (command === "config" || command === "configure" || !isDnsCmd) {
        // redirect to configure page
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

function searchRedirect(b64userflag) {
  const u = "https://rethinkdns.com/search";
  const q = "?s=" + b64userflag; // must be base64 (not base32 aka dot)
  return Response.redirect(u + q, 302);
}

function configRedirect(userFlag, origin, timestamp, highlight) {
  const u = "https://rethinkdns.com/configure";
  let q = "?tstamp=" + timestamp;
  q += !isRethinkDns(origin) ? "&v=ext&u=" + origin : "";
  q += highlight ? "&s=added" : "";
  q += userFlag ? "#" + userFlag : "";
  return Response.redirect(u + q, 302);
}

/**
 * @param {string} queryString
 * @param {BlocklistFilter} blocklistFilter
 * @param {number} latestTimestamp
 * @returns {Response}
 */
function domainNameToList(queryString, blocklistFilter, latestTimestamp) {
  const domainName = queryString.get("dn") || "";
  const r = {
    domainName: domainName,
    version: latestTimestamp,
    list: {},
  };

  const searchResult = blocklistFilter.lookup(domainName);
  if (!searchResult) {
    return jsonResponse(r);
  }

  // ex: max.rethinkdns.com/dntolist?dn=google.com
  // res: { "domainName": "google.com",
  //        "version":"1655223903366",
  //        "list": {  "google.com": {
  //                      "NUI": {
  //                          "value":149,
  //                          "uname":"NUI",
  //                          "vname":"No Google",
  //                          "group":"privacy",
  //                          "subg":"",
  //                          "url":"https://raw.githubuserc...",
  //                          "show":1,
  //                          "entries":304
  //                       }
  //                    }
  //                 },
  //        ...
  //      }
  for (const entry of searchResult) {
    const list = flagsToTags(entry[1]);
    const listDetail = blocklistFilter.extract(list);
    r.list[entry[0]] = listDetail;
  }

  return jsonResponse(r);
}

/**
 * @param {string} queryString
 * @param {BlocklistFilter} blocklistFilter
 * @returns {Response}
 */
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

/**
 * @param {string} queryString
 * @returns {Response}
 */
function listToB64(queryString) {
  const list = queryString.get("list") || [];
  const flagVersion = queryString.get("flagversion") || "0";
  const tags = list.split(",");
  const stamp = rdnsutil.getB64Flag(tagsToFlags(tags), flagVersion);

  const r = {
    command: "List To B64String",
    inputList: list,
    flagVersion: flagVersion,
    b64String: stamp,
  };

  return jsonResponse(r);
}

/**
 * @param {string} queryString
 * @param {BlocklistFilter} blocklistFilter
 * @returns {Response}
 */
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

  // ex: max.rethinkdns.com/b64tolist?b64=1:8N8B2ADg_wP______3____u___Pp_3Ao
  // res: {
  //   "command": "Base64 To List",
  //   "inputB64": "1:8N8B2ADg_wP______3____u___Pp_3Ao",
  //   "list": ["MTF","KBI","HBP","NIM","CZM","HYS","XIF", ...],
  //   "listDetail": { "172": { "value": 172, "uname": "172",
  //                            "vname": "Spotify Ads (GoodbyeAds)",
  //                            "group": "privacy", "subg" : "",
  //                            "url":"https://raw.githubusercontent.com/...",
  //                            "show":1,"entries":3784 },
  //                   "175": {"value":175, "uname":"175",
  //                           "vname":"Combined Privacy Block Lists: Final",
  //                           ...
  //                          }
  //                 ...
  //                 }
  // }
  r.list = flagsToTags(stamp.userBlocklistFlagUint);
  r.listDetail = blocklistFilter.extract(r.list);

  return jsonResponse(r);
}

/**
 * @param {Object} obj
 * @returns {Response}
 */
function jsonResponse(obj) {
  return new Response(JSON.stringify(obj), { headers: util.jsonHeaders() });
}
