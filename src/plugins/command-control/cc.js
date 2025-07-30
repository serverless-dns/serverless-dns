/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import { flagsToTags, tagsToFlags } from "@serverless-dns/trie/stamp.js";
import * as dnsutil from "../../commons/dnsutil.js";
import * as util from "../../commons/util.js";
import { DNSResolver } from "../dns-op/dns-op.js";
import { LogPusher } from "../observability/log-pusher.js";
import * as pres from "../plugin-response.js";
import * as rdnsutil from "../rdns-util.js";
import { BlocklistFilter } from "../rethinkdns/filter.js";
import { BlocklistWrapper } from "../rethinkdns/main.js";
import * as token from "../users/auth-token.js";

export class CommandControl {
  constructor(blocklistWrapper, resolver, logPusher) {
    this.log = log.withTags("CommandControl");
    /** @type {BlocklistWrapper} */
    this.bw = blocklistWrapper;
    /** @type {DNSResolver} */
    this.resolver = resolver;
    /** @type {LogPusher} */
    this.lp = logPusher;
    this.cmds = new Set([
      "configure",
      "config",
      "search",
      "dntolist",
      "dntouint",
      "listtob64",
      "b64tolist",
      "genaccesskey",
      "analytics",
      "logs",
    ]);
  }

  /**
   * @param {{rxid: string, request: Request, lid: string, userAuth: token.Outcome, isDnsMsg: boolean}} ctx
   * @returns {Promise<pres.RResp>}
   */
  async exec(ctx) {
    // process only GET requests, ignore all others
    if (util.isGetRequest(ctx.request)) {
      return await this.commandOperation(
        ctx.rxid,
        ctx.request,
        ctx.isDnsMsg,
        ctx.userAuth,
        ctx.lid
      );
    }

    // no-op
    return pres.emptyResponse();
  }

  isAnyCmd(s) {
    return this.cmds.has(s);
  }

  userCommands(url) {
    // r.x/a/b/c/ => ["", "a", "b", "c", ""]
    // abc.r.x/a => ["", "a"]
    const p = url.pathname.split("/").filter((s) => !util.emptyString(s));

    if (!p || p.length <= 0) return [];

    return p;
  }

  userFlag(url, isDnsCmd = false) {
    // When incoming request is a dns-msg, all cmds are no-op
    if (isDnsCmd) return "";

    return rdnsutil.blockstampFromUrl(url);
  }

  /**
   * @param {string} rxid
   * @param {Request} req
   * @param {boolean} isDnsCmd
   * @param {token.Outcome} auth
   * @param {string} lid
   */
  async commandOperation(rxid, req, isDnsCmd, auth, lid) {
    const url = req.url;
    let response = pres.emptyResponse();

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

      const cmds = this.userCommands(reqUrl, isDnsCmd);
      const b64UserFlag = this.userFlag(url, isDnsCmd);
      // if userflag is same as cmd1, then cmd2 must be the actual cmd
      // consider urls: r.tld/cmd/flag & r.tld/flag/cmd
      // by default, treat cmd1 (at path[1]) as cmd, regardless
      let command = cmds[0];
      for (const c of cmds) {
        if (this.isAnyCmd(c)) {
          command = c;
          break;
        }
      }

      this.log.d(rxid, url, "processing... cmd/flag", command, b64UserFlag);

      // blocklistFilter may not have been setup, so set it up
      await this.bw.init(rxid, /* force-wait */ true);
      const blf = this.bw.getBlocklistFilter();
      if (!rdnsutil.isBlocklistFilterSetup(blf)) throw new Error("no blf");
      const blfts = this.bw.timestamp(); // throws err if basicconfig is not set

      if (command === "listtob64") {
        // convert blocklists (tags) to blockstamp (b64)
        response.data.httpResponse = listToB64(queryString);
      } else if (command === "b64tolist") {
        // convert blockstamp (b64) to blocklists (tags)
        response.data.httpResponse = b64ToList(queryString, blf);
      } else if (command === "dntolist") {
        // convert names to blocklists (tags)
        response.data.httpResponse = await domainNameToList(
          rxid,
          this.resolver,
          blfts,
          req,
          queryString,
          blf
        );
      } else if (command === "dntouint") {
        // convert names to flags
        response.data.httpResponse = domainNameToUint(
          this.resolver,
          queryString,
          blf
        );
      } else if (command === "search") {
        // redirect to the search page with blockstamp (b64) preloaded
        response.data.httpResponse = searchRedirect(b64UserFlag);
      } else if (command === "genaccesskey") {
        // generate a token
        response.data.httpResponse = await generateAccessKey(
          queryString,
          reqUrl.hostname
        );
      } else if (command === "analytics") {
        // redirect to the analytics page
        response.data.httpResponse = await analytics(
          this.lp,
          reqUrl,
          auth,
          lid
        );
      } else if (command === "logs") {
        // redirect to the logs page
        response.data.httpResponse = await logs(this.lp, reqUrl, auth, lid);
      } else if (command === "config" || command === "configure" || !isDnsCmd) {
        // redirect to configure page
        response.data.httpResponse = configRedirect(
          b64UserFlag,
          reqUrl.origin,
          rdnsutil.bareTimestampFrom(blfts),
          !isDnsCmd
        );
      } else {
        this.log.w(rxid, "unknown command-control query");
        response.data.httpResponse = util.respond400();
      }
    } catch (e) {
      this.log.e(rxid, "err cc:op", e.stack);
      response = pres.errResponse("cc:op", e);
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

// Redirect to the configure webpage when _no commands_ are set.
// This happens when user clicks, say XYZ.max.rethinkdns.com or
// max.rethinkdns.com/XYZ and it opens in a browser.
function configRedirect(userFlag, origin, timestamp, highlight) {
  const u = "https://rethinkdns.com/configure";
  let q = "?tstamp=" + timestamp;
  q += !isRethinkDns(origin) ? "&v=ext&u=" + origin : "";
  q += highlight ? "&s=added" : "";
  q += userFlag ? "#" + userFlag : "";
  return Response.redirect(u + q, 302);
}

async function generateAccessKey(queryString, hostname) {
  const msg = queryString.get("key");
  const dom = queryString.get("dom");
  if (!util.emptyString(dom)) {
    hostname = dom;
  }
  const toks = [];
  for (const d of util.domains(hostname)) {
    if (util.emptyString(d)) continue;

    const [_, hexcat] = await token.gen(msg, d);
    toks.push(hexcat);
  }

  return jsonResponse({ accesskey: toks, context: token.info });
}

/**
 *
 * @param {LogPusher} lp
 * @param {URL} reqUrl
 * @param {token.Outcome} auth
 * @param {string} lid
 * @returns {Promise<Response>}
 */
async function logs(lp, reqUrl, auth, lid) {
  if (util.emptyString(lid) || auth.no) {
    return util.respond401();
  }

  const p = reqUrl.searchParams;
  const s = p.get("start");
  const e = p.get("end");
  const b = await lp.remotelogs(lid, s, e);
  // do not await on the response body, instead stream it out
  // blog.cloudflare.com/workers-optimization-reduces-your-bill
  return plainResponse(b);
}

/**
 * @param {LogPusher} lp
 * @param {URL} reqUrl
 * @param {token.Outcome} auth
 * @param {string} lid
 * @returns {Promise<Response>}
 */
async function analytics(lp, reqUrl, auth, lid) {
  if (util.emptyString(lid) || auth.no) {
    return util.respond401();
  }

  const p = reqUrl.searchParams;
  const t = p.get("t");
  const f = p.getAll("f");
  const d = p.get("d");
  const l = p.get("l");
  const r = await lp.count1(lid, f, t, d, l);
  // do not await on the response body, instead stream it out
  // blog.cloudflare.com/workers-optimization-reduces-your-bill
  return plainResponse(r.body);
}

/**
 * @param {string} rxid
 * @param {DNSResolver} resolver
 * @param {string} ts
 * @param {Request} req
 * @param {string} queryString
 * @param {BlocklistFilter} blocklistFilter
 * @returns {Promise<Response>}
 */
async function domainNameToList(
  rxid,
  resolver,
  ts,
  req,
  queryString,
  blocklistFilter
) {
  const domainName = queryString.get("dn") || "";
  const latestTimestamp = util.bareTimestampFrom(ts);
  const r = {
    domainName: domainName,
    version: latestTimestamp,
    list: {},
  };

  // qid for doh is always 0
  const qid = 0;
  const qs = [
    {
      type: "A",
      name: domainName,
    },
  ];
  // only doh truly works across runtimes, workers/fastly/node/deno
  const forcedoh = true;
  const query = dnsutil.mkQ(qid, qs);
  const querypacket = dnsutil.decode(query);
  const rmax = resolver.determineDohResolvers(resolver.ofMax(), forcedoh);
  const res = await resolver.resolveDnsUpstream(
    rxid,
    ts,
    req,
    rmax,
    query,
    querypacket
  );
  const ans = await res.arrayBuffer();
  let anspacket;
  try {
    anspacket = dnsutil.decode(ans);
  } catch (e) {
    log.w(rxid, "malformed dns response in command-control:", e.message);
    return r; // empty response
  }
  const ansdomains = dnsutil.extractDomains(anspacket);

  for (const d of ansdomains) {
    const searchResult = blocklistFilter.lookup(d);
    if (!searchResult) continue;

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
  }

  return jsonResponse(r);
}

/**
 * @param {string} queryString
 * @param {BlocklistFilter} blocklistFilter
 * @returns {Response}
 */
function domainNameToUint(queryString, blocklistFilter) {
  // TODO: resolve the query like in domainNameToList
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

/**
 * @param {ReadableStream<*>?} body
 * @returns {Response}
 */
function plainResponse(body) {
  return new Response(body, { headers: util.corsHeaders() });
}
