/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { services } from "./svc.js";
import * as bufutil from "../commons/bufutil.js";
import * as dnsutil from "../commons/dnsutil.js";
import * as envutil from "../commons/envutil.js";
import * as rdnsutil from "../plugins/rdns-util.js";
import * as util from "../commons/util.js";
import IOState from "./io-state.js";
import { RResp } from "../plugins/plugin-response.js";

export default class RethinkPlugin {
  /**
   *
   * @param {{request: Request, waitUntil: Function, respondWith: Function}} event
   */
  constructor(event) {
    if (!services.ready) throw new Error("services not ready");
    /**
     * Parameters of RethinkPlugin which may be used by individual plugins.
     */
    this.ctx = new Map();

    const rxid = util.rxidFromHeader(event.request.headers) || util.xid();
    this.addCtx("rxid", "[rx." + rxid + "]");

    // log-id specific to this request, if missing, no logs will be emitted
    this.addCtx("lid", extractLid(event.request.url));

    // works on fly.io and cloudflare
    this.addCtx("region", getRegion(event.request) || "");

    // caution: event isn't an event on nodejs, but event.request is a request
    this.addCtx("request", event.request);

    // TODO: a more generic way for plugins to queue events on all platforms
    // dispatcher fn when called, fails with 'illegal invocation' if not
    // bound explicitly to 'event' (since it then executes in the context
    // of which-ever obj calls it): stackoverflow.com/a/9678166
    this.addCtx("dispatcher", event.waitUntil.bind(event));

    this.log = log.withTags("RethinkPlugin");

    /** @type {Array<RPlugin>} */
    this.plugin = [];

    this.registerPlugin(
      "userOp",
      services.userOp,
      ["rxid", "request", "requestDecodedDnsPacket", "isDnsMsg"],
      this.userOpCallback
    );

    // filter out undelegated domains if running recurisve resolver
    envutil.recursive() &&
      this.registerPlugin(
        "prefilter",
        services.prefilter,
        ["rxid", "requestDecodedDnsPacket"],
        this.prefilterCallback
      );

    this.registerPlugin(
      "cacheOnlyResolver",
      services.dnsCacheHandler,
      ["rxid", "userBlocklistInfo", "requestDecodedDnsPacket", "isDnsMsg"],
      this.dnsCacheCallback
    );

    this.registerPlugin(
      "commandControl",
      services.commandControl,
      ["rxid", "userAuth", "lid", "request", "isDnsMsg"],
      this.commandControlCallback
    );

    this.registerPlugin(
      "dnsResolver",
      services.dnsResolver,
      [
        "rxid",
        "dispatcher",
        "request",
        // resolver-url overriden by user-op
        "userDnsResolverUrl",
        "userBlocklistInfo",
        "userBlockstamp",
        "domainBlockstamp",
        "requestDecodedDnsPacket",
        "requestBodyBuffer",
      ],
      this.dnsResolverCallback
    );

    this.registerPlugin(
      "logpush",
      services.logPusher,
      [
        "rxid",
        "lid",
        "isDnsMsg",
        "dispatcher",
        "request",
        // resolver-url overriden by user-op, may be null
        "userDnsResolverUrl",
        // may be missing if req isn't a dns query
        "requestDecodedDnsPacket",
        // may be missing in case of exceptions or blocked answers
        "responseDecodedDnsPacket",
        // may be missing in case the dns query isn't blocked
        "blockflag",
        // only valid on platforms, fly and cloudflare
        "region",
      ],
      util.stubAsync, // no callback
      true, // always exec this plugin
      true // on exception, don't exec
    );
  }

  addCtx(k, v) {
    this.ctx.set(k, v);
  }

  /**
   *
   * @param {string} name
   * @param {any} mod
   * @param {Array<string>} pctx
   * @param {function?} cb
   * @param {boolean} alwaysexec
   */
  registerPlugin(name, mod, pctx, cb, alwaysexec = false, bail = false) {
    this.plugin.push(new RPlugin(name, mod, pctx, cb, alwaysexec, bail));
  }

  async execute() {
    const io = this.io;
    // const rxid = this.ctx.get("rxid");
    for (const p of this.plugin) {
      if (io.stopProcessing && !p.continueOnStopProcess) {
        continue;
      }
      if (io.isException && p.bailOnException) {
        continue;
      }

      const res = await p.module.exec(makectx(this.ctx, p.pctx));

      if (typeof p.callback === "function") {
        await p.callback.call(this, res, io);
      }
    }
  }

  /**
   * @param {RResp} response
   * @param {IOState} io
   */
  async commandControlCallback(response, io) {
    const rxid = this.ctx.get("rxid");
    const r = response.data;
    this.log.d(rxid, "command-control response");

    if (!util.emptyObj(r) && r.stopProcessing) {
      this.log.d(rxid, "command-control reply", r);
      io.hResponse(r.httpResponse);
    }
  }

  /**
   * Adds "userBlocklistInfo", "userBlocklistInfo",  and "dnsResolverUrl"
   * to RethinkPlugin ctx.
   * @param {RResp} response
   * @param {IOState} io
   */
  async userOpCallback(response, io) {
    const rxid = this.ctx.get("rxid");
    const r = response.data;
    this.log.d(rxid, "user-op response");

    if (response.isException) {
      this.log.w(rxid, "unexpected err userOp", r);
      this.loadException(rxid, response, io);
    } else if (!util.emptyObj(r)) {
      // will only be null in case of errors
      const a = r.userAuth;
      // r.userBlocklistInfo and r.dnsResolverUrl may be "null"
      const bi = r.userBlocklistInfo;
      const rr = r.dnsResolverUrl;
      // may be empty string; usually of form "v:base64" or "v-base32"
      const bs = r.userBlocklistFlag;
      this.log.d(rxid, "set user:auth/blockInfo/resolver/stamp", a, bi, rr, bs);
      this.addCtx("userAuth", a);
      this.addCtx("userBlocklistInfo", bi);
      this.addCtx("userBlockstamp", bs);
      this.addCtx("userDnsResolverUrl", rr);
    } else {
      this.log.i(rxid, "user-op is a no-op, possibly a command-control req");
    }
  }

  /**
   * @param {RResp} response
   * @param {IOState} io
   */
  prefilterCallback(response, io) {
    const rxid = this.ctx.get("rxid");
    const r = response.data;
    const deny = r.isBlocked;
    const err = response.isException;
    this.log.d(rxid, "prefilter deny?", deny, "err?", err);

    if (err) {
      this.log.w(rxid, "prefilter: error", r);
      this.loadException(rxid, response, io);
    } else if (deny) {
      io.dnsNxDomainResponse(r.flag);
    } else {
      this.log.d(rxid, "prefilter no-op");
    }
  }

  /**
   * @param {RResp} response
   * @param {IOState} io
   */
  dnsCacheCallback(response, io) {
    const rxid = this.ctx.get("rxid");
    const r = response.data;
    const deny = r.isBlocked;
    const isAns = dnsutil.isAnswer(r.dnsPacket);
    const noErr = dnsutil.rcodeNoError(r.dnsPacket);

    this.log.d(rxid, "crr: block?", deny, "ans?", isAns, "noerr", noErr);

    if (response.isException) {
      this.loadException(rxid, response, io);
    } else if (deny) {
      this.addCtx("blockflag", r.flag);
      // TODO: create block packets/buffers in dnsBlocker.js
      io.dnsBlockResponse(r.flag);
    } else if (isAns) {
      this.addCtx("responseBodyBuffer", r.dnsBuffer);
      this.addCtx("responseDecodedDnsPacket", r.dnsPacket);
      this.addCtx("blockflag", r.flag);
      io.dnsResponse(r.dnsBuffer, r.dnsPacket, r.flag);
    } else {
      this.addCtx("domainBlockstamp", r.stamps);
      this.log.d(rxid, "resolve query; no response from cache-handler");
    }
  }

  /**
   * Adds "responseBodyBuffer" (arrayBuffer of dns response from upstream
   * resolver) to RethinkPlugin ctx
   * @param {RResp} response
   * @param {IOState} io
   */
  dnsResolverCallback(response, io) {
    const rxid = this.ctx.get("rxid");
    const r = response.data;
    const deny = r.isBlocked;
    // dns packets may have no answers, but still be a valid response
    // for example, servfail do not contain any answers, whereas
    // nxdomain has an authority-section (but no answers).
    const isAns = dnsutil.isAnswer(r.dnsPacket);
    const noErr = dnsutil.rcodeNoError(r.dnsPacket);
    this.log.d(rxid, "rr: block?", deny, "ans?", isAns, "noerr?", noErr);

    if (deny) {
      // TODO: create block packets/buffers in dnsBlocker.js?
      this.addCtx("blockflag", r.flag);
      io.dnsBlockResponse(r.flag);
    } else if (response.isException || !isAns) {
      // if not blocked, but then, no-ans or is-exception, then:
      this.loadException(rxid, response, io);
    } else {
      this.addCtx("responseBodyBuffer", r.dnsBuffer);
      this.addCtx("responseDecodedDnsPacket", r.dnsPacket);
      this.addCtx("blockflag", r.flag);
      io.dnsResponse(r.dnsBuffer, r.dnsPacket, r.flag);
    }
  }

  /**
   *
   * @param {String} rxid
   * @param {RResp} response
   * @param {IOState} io
   */
  loadException(rxid, response, io) {
    this.log.e(rxid, "exception", JSON.stringify(response));
    io.dnsExceptionResponse(response);
  }

  /**
   * @param {IOState} io
   * @returns
   */
  async initIoState(io) {
    this.io = io;

    const request = this.ctx.get("request");
    const rxid = this.ctx.get("rxid");
    const region = this.ctx.get("region");
    const isDnsMsg = util.isDnsMsg(request);
    const isGwReq = util.isGatewayRequest(request);
    let question = null;

    io.id(rxid, region);

    this.addCtx("isDnsMsg", isDnsMsg);
    // nothing to do if the current request isn't a dns question
    if (!isDnsMsg) {
      // throw away any request that is not a dns-msg since cc.js
      // processes non-dns msgs only via GET, while rest of the
      // plugins process only dns-msgs via GET and POST.
      if (!util.isGetRequest(request)) {
        this.log.i(rxid, "not a dns-msg, not a GET req either", request);
        io.hResponse(util.respond405());
        return;
      }
    }

    // else: treat doh as if it was a dns-msg iff "dns" query-string is set
    question = await extractDnsQuestion(request);

    // not a dns request
    if (bufutil.emptyBuf(question)) return;

    if (isGwReq) io.gatewayAnswersOnly(envutil.gwip4(), envutil.gwip6());

    try {
      const [qpacket, ecsdropped] = dnsutil.dropECS(dnsutil.decode(question));
      // if ecs was removed, then re-encode the question
      if (ecsdropped) {
        question = dnsutil.encode(qpacket);
      }

      io.input(qpacket);
      this.addCtx("isDnsMsg", true);
      this.log.d(rxid, "cur-ques", JSON.stringify(qpacket.questions));

      this.addCtx("requestDecodedDnsPacket", qpacket);
      this.addCtx("requestBodyBuffer", question);
    } catch (e) {
      // err if question is not a valid dns-packet
      this.log.d(rxid, "cannot decode dns query; may be cc GET req?");
      // TODO: io.hResponse(util.respond400()) instead?
      // at this point: req is GET and has "dns" in its url-string
      // but: is not a valid dns request
      return;
    }
  }
}

/**
 * Makes ctx for a plugin
 * @param {Map<String, Object>} context - Execution context
 * @param {String[]} ctxkeys - Context required by a plugin
 * @returns {*} - A context object
 */
function makectx(context, ctxkeys) {
  const out = {};
  for (const key of ctxkeys) {
    out[key] = context.get(key) || null;
  }
  return out;
}

// TODO: fetch lid from config store
function extractLid(url) {
  // if lid is not present in url, then return hostname delimited by "_"
  let lid = util.fromPath(url, rdnsutil.logPrefix);

  if (util.emptyString(lid) && envutil.logpushHostnameAsLogid()) {
    lid = util.tld(url, 0, "_");
  }

  return lid || "";
}

async function extractDnsQuestion(request) {
  if (util.isPostRequest(request)) {
    return await request.arrayBuffer();
  } else {
    // TODO: okay to assume GET request?
    const queryString = new URL(request.url).searchParams;
    const dnsQuery = queryString.get("dns");
    return bufutil.base64ToBytes(dnsQuery);
  }
}

function getRegion(request) {
  if (envutil.onCloudflare()) {
    return util.regionFromCf(request);
  } else if (envutil.onFly()) {
    return envutil.region();
  } else if (envutil.onFastly()) {
    // TODO: impl for fastly
  }
  return "";
}

class RPlugin {
  constructor(name, mod, pctx, cb, alwaysexec, bail) {
    /** @type {String} */
    this.name = name;
    /** @type {{exec: function(Object): Promise<RResp>} */
    this.module = mod;
    /** @type {String[]} */
    this.pctx = pctx;
    /** @type {Function} */
    this.callback = cb;
    /** @type {boolean} */
    this.continueOnStopProcess = alwaysexec;
    /** @type {boolean} */
    this.bailOnException = bail;
  }
}
