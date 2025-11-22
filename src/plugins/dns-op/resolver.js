/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as bufutil from "../../commons/bufutil.js";
import * as dnsutil from "../../commons/dnsutil.js";
import * as envutil from "../../commons/envutil.js";
import * as util from "../../commons/util.js";
import { log } from "../../core/log.js";
import * as system from "../../system.js";
import * as cacheutil from "../cache-util.js";
import * as pres from "../plugin-response.js";
import * as rdnsutil from "../rdns-util.js";
import { BlocklistFilter } from "../rethinkdns/filter.js";
import { DnsBlocker } from "./blocker.js";

export default class DNSResolver {
  /**
   * @param {import("../rethinkdns/main.js").BlocklistWrapper} blocklistWrapper
   * @param {import("./cache.js").DnsCache} cache
   * @param {any} dns53
   */
  constructor(blocklistWrapper, cache, dns53) {
    /** @type {import("./cache.js").DnsCache} */
    this.cache = cache;
    this.blocker = new DnsBlocker();
    /** @type {import("../rethinkdns/main.js").BlocklistWrapper} */
    this.bw = blocklistWrapper;
    // deno bundler not happy with typedef as it imports node:dgram
    // @type {import("../../core/node/dns-transport.js").Transport}
    this.transport = dns53 || null;
    this.log = log.withTags("DnsResolver");

    this.measurements = [];
    this.coalstats = { tot: 0, pub: 0, empty: 0, try: 0 };
    this.profileResolve = envutil.profileDnsResolves();
    // only valid on nodejs
    this.forceDoh = envutil.forceDoh();
    this.timeout = (envutil.workersTimeout() / 2) | 0;

    // only valid on workers
    // bg-bw-init results in higher io-wait, not lower
    // p99 gb-sec (0.04 => 0.06); p99.9 gb-sec (0.09 => 0.14)
    // also: from commit 35a557efe69e (14 Nov 2022) to 6b9a2e9f (25 Nov 2022)
    // the cpu time has gone up for p50 ms (2.2 => 2.7); p75 (3.9 => 6.6);
    // p99 (21.2 => 31.5); p99.9 (60 => 72.2); p50 gb-sec (.002 => .003)
    // p75 (.004 => .007); p99 (.026 => .039); p99.9 (.069 => .126)
    // it turned out that the trie-cache wasn't being used at all due to
    // a missing version bump (npm update fixed it).
    this.bgBwInit = envutil.bgDownloadBlocklistWrapper();
    this.maxDoh = envutil.maxDohUrl();

    if (this.profileResolve) {
      this.log.w("profiling", this.determineDohResolvers());
      this.log.w("doh?", this.forceDoh);
    } else {
      const cok = this.cache != null;
      const dok = this.transport != null;
      this.log.i("init: cache?", cok, "dns53?", dok, "doh?", this.forceDoh);
    }
  }

  async close() {
    this.log.i("closing resolver (& transport?", this.transport != null, ")");
    if (this.transport) return await this.transport.teardown();
  }

  /**
   * @param {Object} ctx
   * @param {String} ctx.rxid
   * @param {Request} ctx.request
   * @param {ArrayBuffer} ctx.requestBodyBuffer
   * @param {Object} ctx.requestDecodedDnsPacket
   * @param {Object} ctx.userBlocklistInfo
   * @param {String} ctx.userDnsResolverUrl
   * @param {string} ctx.userBlockstamp
   * @param {function(function):void} ctx.dispatcher
   * @returns {Promise<pres.RResp>}
   */
  async exec(ctx) {
    let response = pres.emptyResponse();

    try {
      response.data = await this.resolveDns(ctx);
    } catch (e) {
      response = pres.errResponse("dnsResolver", e);
      this.log.e(ctx.rxid, "main", e.stack);
    }

    return response;
  }

  determineDohResolvers(preferredDoh, forceDoh = this.forceDoh) {
    // when this.transport is set, do not use doh unless forced
    if (this.transport && !forceDoh) return [];

    if (!util.emptyString(preferredDoh)) {
      return [preferredDoh];
    }

    // if blocklists aren't setup, return only primary because blocklists
    // themselves need min 4 network-io solts of the 6 available on Workers
    if (!this.bw.disabled() && !this.bw.isBlocklistFilterSetup()) {
      return [envutil.primaryDohResolver()];
    }

    return envutil.dohResolvers();
  }

  // TODO: nodejs.org/api/perf_hooks.html
  // github: pola-rs/polars@475cf3c/nodejs-polars/benches/list-operations.js
  // Deno perf-hooks: github.com/denoland/deno/issues/5386
  // WebAPI: developer.mozilla.org/en-US/docs/Web/API/Performance
  logMeasurementsPeriodically(period = 100) {
    const len = this.measurements.length - 1;
    // log after period number of measurements are done
    if ((len + 1) % period !== 0) return;

    this.measurements.sort((a, b) => a - b);
    const p10 = this.measurements[Math.floor(len * 0.1)];
    const p50 = this.measurements[Math.floor(len * 0.5)];
    const p75 = this.measurements[Math.floor(len * 0.75)];
    const p90 = this.measurements[Math.floor(len * 0.9)];
    const p95 = this.measurements[Math.floor(len * 0.95)];
    const p99 = this.measurements[Math.floor(len * 0.99)];
    const p999 = this.measurements[Math.floor(len * 0.999)];
    const p9999 = this.measurements[Math.floor(len * 0.9999)];
    const p100 = this.measurements[len];

    this.log.qStart("runs:", len + 1);
    this.log.q("p10/50/75/90/95", p10, p50, p75, p90, p95);
    this.log.qEnd("p99/99.9/99.99/100", p99, p999, p9999, p100);
  }

  /**
   * @param {Object} ctx
   * @param {String} ctx.rxid
   * @param {Request} ctx.request
   * @param {ArrayBuffer} ctx.requestBodyBuffer
   * @param {Object} ctx.requestDecodedDnsPacket
   * @param {pres.BlockstampInfo} ctx.userBlocklistInfo
   * @param {String} ctx.userDnsResolverUrl
   * @param {string} ctx.userBlockstamp
   * @param {pres.BStamp?} ctx.domainBlockstamp
   * @param {function(function):void} ctx.dispatcher
   * @returns {Promise<pres.RResp>}
   */
  async resolveDns(ctx) {
    const rxid = ctx.rxid;
    const req = ctx.request;
    const blInfo = ctx.userBlocklistInfo;
    const rawpacket = ctx.requestBodyBuffer;
    const decodedpacket = ctx.requestDecodedDnsPacket;
    const userDns = ctx.userDnsResolverUrl;
    const forceUserDns = this.forceDoh || !util.emptyString(userDns);
    const dispatcher = ctx.dispatcher;
    const userBlockstamp = ctx.userBlockstamp;
    // may be null or empty-obj (stamp then needs to be got from blf)
    // may be a obj { domainName: String -> blockstamps: Uint16Array }
    const stamps = ctx.domainBlockstamp;

    let blf = this.bw.getBlocklistFilter();
    const isBlfDisabled = this.bw.disabled();
    let isBlfSetup = rdnsutil.isBlocklistFilterSetup(blf);
    const ts = this.bw.timestamp(util.yyyymm());

    // if both blocklist-filter (blf) and stamps are not setup, question-block
    // is a no-op, while we expect answer-block to catch the block regardless.
    const q = this.makeRdnsResponse(rxid, rawpacket, blf, stamps);

    this.blocker.blockQuestion(rxid, /* out*/ q, blInfo);
    this.log.d(rxid, "q block?", q.isBlocked, "blf?", isBlfSetup, "ts?", ts);

    if (q.isBlocked) {
      this.primeCache(rxid, ts, q, dispatcher);
      return q;
    }

    let resolveStart = 0;
    let resolveEnd = 0;
    if (this.profileResolve) {
      resolveStart = Date.now();
    }

    let fromMax = false;
    let promisedTasks = null;
    if (!isBlfSetup && this.bgBwInit) {
      const alt = this.ofMax(userBlockstamp);
      fromMax = true;
      this.log.d(rxid, "bg-bw-init; upstream to max", alt);
      dispatcher(this.bw.init(rxid));
      promisedTasks = await Promise.allSettled([
        Promise.resolve(), // placeholder promise that never rejects
        this.resolveDnsUpstream(
          rxid,
          ts,
          req,
          this.determineDohResolvers(alt, /* forceDoh */ true),
          rawpacket,
          decodedpacket
        ),
      ]);
    } else {
      // nested async calls (async fn calling another async fn)
      // need to await differently depending on what's returned:
      // case1:
      // fulfiller = async () => { return "123"; }
      // wrapper = async () => { return fulfiller(); }
      // result = await wrapper() :: outputs "123"
      // case2:
      // arrayWrapper = async () => { return [fulfiller()]; }
      // result1 = await arrayWrapper() :: outputs "Array[Promise{}]"
      // result2 = await result1[0] :: outputs "123"
      promisedTasks = await Promise.allSettled([
        this.bw.init(rxid),
        this.resolveDnsUpstream(
          rxid,
          ts,
          req,
          this.determineDohResolvers(userDns, forceUserDns),
          rawpacket,
          decodedpacket
        ),
      ]);
    }

    for (const task of promisedTasks) {
      if (task.status === "rejected") {
        throw new Error(`task rejected ${task.reason}`);
      } // else: task.status === "fulfilled"
    }

    if (this.profileResolve) {
      resolveEnd = Date.now();
      this.measurements.push(resolveEnd - resolveStart);
      this.logMeasurementsPeriodically();
    }

    // developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled#return_value
    /** @type{Response} */
    const res = promisedTasks[1].value;

    if (fromMax) {
      // blf would be eventually be init'd in the background
      isBlfSetup = true;
    } else if (!isBlfSetup && !isBlfDisabled) {
      this.log.d(rxid, "blocklist-filter downloaded and setup");
      blf = this.bw.getBlocklistFilter();
      isBlfSetup = rdnsutil.isBlocklistFilterSetup(blf);
    } else {
      // override, as blocklists disabled
      isBlfSetup = true;
    }

    if (!isBlfSetup) throw new Error(rxid + " no blocklist-filter");
    if (!res) throw new Error(rxid + " no upstream result");

    if (!res.ok) {
      const txt = res.text && (await res.text());
      this.log.w(rxid, "!OK", res.status, txt);
      throw new Error(txt + " http err: " + res.status + " " + res.statusText);
    }

    const ans = await res.arrayBuffer();

    let r;
    try {
      r = this.makeRdnsResponse(rxid, ans, blf, stamps);
    } catch (e) {
      this.log.w(rxid, "upstream returned malformed dns response:", e.message);
      const pkt = dnsutil.servfail(decodedpacket.id, decodedpacket.questions);
      r = pres.dnsResponse(dnsutil.decode(pkt), pkt, stamps);
    }

    // blockAnswer is a no-op if the ans is already quad0
    // check outgoing cached dns-packet against blocklists
    this.blocker.blockAnswer(rxid, /* out*/ r, blInfo);
    const fromCache = cacheutil.hasCacheHeader(res.headers);
    this.log.d(rxid, "a block?", r.isBlocked, "c?", fromCache, "max?", fromMax);

    // if res was got from caches or if res was got from max doh (ie, blf
    // wasn't used to retrieve stamps), then skip hydrating the cache
    if (!fromCache && !fromMax) {
      this.primeCache(rxid, ts, r, dispatcher);
    }
    return r;
  }

  /**
   * @param {string} rxid
   * @param {ArrayBuffer} raw
   * @param {BlocklistFilter} blf
   * @param {pres.BStamp?} stamps
   * @returns {pres.RespData}
   * @throws if raw is a malformed dns packet or not a dns packet.
   */
  makeRdnsResponse(rxid, raw, blf, stamps = null) {
    if (!raw) throw new Error(rxid + " mk-res no upstream result");

    const dnsPacket = dnsutil.decode(raw); // may throw if malformed
    // stamps are empty for domains that are not in any blocklist
    // but there's no way to know if that was indeed the case as
    // stamps are sent here by cache-resolver, which may or may not
    // have retrieved the stamps in the first-place.
    stamps = util.emptyObj(stamps)
      ? rdnsutil.blockstampFromBlocklistFilter(dnsPacket, blf)
      : stamps;

    return pres.dnsResponse(dnsPacket, raw, stamps);
  }

  /**
   * @param {string} rxid
   * @param {string} ts
   * @param {pres.RespData} r
   * @param {function(function):void} dispatcher
   * @returns {Promise<void>}
   */
  primeCache(rxid, ts, r, dispatcher) {
    const blocked = r.isBlocked;
    const k = cacheutil.makeHttpCacheKey(r.dnsPacket, ts);
    if (!k) {
      this.log.d(rxid, "primeCache: no key, url/query missing?", k, r.stamps);
      return;
    }

    this.log.d(rxid, "primeCache: block?", blocked, "k", k.href);
    const v = cacheutil.cacheValueOf(r);
    this.cache.put(k, v, dispatcher);
  }

  ofMax(blockstamp) {
    if (util.emptyString(this.maxDoh)) return "";
    if (util.emptyString(blockstamp)) return this.maxDoh;
    else return this.maxDoh + blockstamp;
  }
}

/**
 * @param {String} rxid
 * @param {String} ts
 * @param {Request} request
 * @param {String[]} resolverUrls
 * @param {ArrayBuffer} query
 * @param {any} packet
 * @returns {Promise<Response|Error>}
 */
DNSResolver.prototype.resolveDnsUpstream = async function (
  rxid,
  ts,
  request,
  resolverUrls,
  query,
  packet
) {
  // if no doh upstreams set, resolve over plain-old dns
  if (util.emptyArray(resolverUrls)) {
    const eid = cacheutil.makeId(packet);
    /** @type {ArrayBuffer[]?} */
    let parcel = null;

    try {
      const g = await system.when(eid, this.timeout);
      this.coalstats.tot += 1;
      if (!util.emptyArray(g) && g[0] != null) {
        const sz = bufutil.len(g[0]);
        this.log.d(rxid, "coalesced", eid, sz, this.coalstats);
        if (sz > 0) return Promise.resolve(new Response(g[0]));
      }
      this.coalstats.empty += 1;
      this.log.e(rxid, "empty coalesced", eid, this.coalstats);
      return Promise.resolve(util.respond503());
    } catch (reason) {
      // happens on timeout or if new event, eid
      this.coalstats.try += 1;
      this.log.d(rxid, "not coalesced", eid, reason, this.coalstats);
    }

    if (this.transport == null) {
      this.log.e(rxid, "plain dns transport not set");
      this.coalstats.pub += 1;
      system.pub(eid, parcel);
      return Promise.reject(new Error("plain dns transport not set"));
    }

    let promisedResponse = null;
    try {
      // do not let exceptions passthrough to the caller
      const q = bufutil.bufferOf(query);

      let ans = await this.transport.udpquery(rxid, q);
      if (dnsutil.truncated(ans)) {
        this.log.w(rxid, "ans truncated, retrying over tcp");
        ans = await this.transport.tcpquery(rxid, q);
      }

      if (ans) {
        const ab = bufutil.arrayBufferOf(ans);
        parcel = [ab];
        promisedResponse = Promise.resolve(new Response(ab));
      } else {
        promisedResponse = Promise.resolve(util.respond503());
      }
    } catch (e) {
      this.log.e(rxid, "err when querying plain old dns", e.stack);
      promisedResponse = Promise.reject(e);
    }

    this.coalstats.pub += 1;
    system.pub(eid, parcel);
    return promisedResponse;
  }

  // Promise.any on promisedPromises[] only works if there are
  // zero awaits in this function or any of its downstream calls.
  // Otherwise, the first reject in promisedPromises[], before
  // any statement in the call-stack awaits, would throw unhandled
  // error, since the event loop would have 'ticked' and Promise.any
  // on promisedPromises[] would still not have been executed, as it
  // is the last statement of this function (which would have eaten up
  // all rejects as long as there was one resolved promise).
  const promisedPromises = [];
  try {
    // upstream to cache
    this.log.d(rxid, "upstream cache");
    promisedPromises.push(this.resolveDnsFromCache(rxid, ts, packet));

    // upstream to resolvers
    for (const rurl of resolverUrls) {
      if (util.emptyString(rurl)) {
        this.log.w(rxid, "missing resolver url", rurl, "among", resolverUrls);
        continue;
      }

      const u = new URL(request.url);
      const upstream = new URL(rurl);
      u.hostname = upstream.hostname; // default cloudflare-dns.com
      u.pathname = upstream.pathname; // override path, default /dns-query
      u.port = upstream.port; // override port, default 443
      u.protocol = upstream.protocol; // override proto, default https

      let dnsreq = null;
      // even for GET requests, plugin.js:getBodyBuffer converts contents of
      // u.search into an arraybuffer that then needs to be reconverted back
      if (util.isGetRequest(request)) {
        u.search = "?dns=" + bufutil.bytesToBase64Url(query);
        dnsreq = new Request(u.href, {
          method: "GET",
          headers: util.dnsHeaders(),
          signal: AbortSignal.timeout(this.timeout),
        });
      } else if (util.isPostRequest(request)) {
        dnsreq = new Request(u.href, {
          method: "POST",
          headers: util.concatHeaders(
            util.contentLengthHeader(query),
            util.dnsHeaders()
          ),
          body: query,
          signal: AbortSignal.timeout(this.timeout),
        });
      } else {
        throw new Error("get/post only");
      }

      this.log.d(rxid, "upstream doh2/fetch", u.href);
      promisedPromises.push(fetch(dnsreq));
    }
  } catch (e) {
    this.log.e(rxid, "err doh2/fetch upstream", e.stack);
    promisedPromises.push(Promise.reject(e));
  }

  // Promise.any returns any rejected promise if none resolved; node v15+
  return Promise.any(promisedPromises);
};

/**
 * resolveDnsFromCache answers query requested by packet from local or remote cache.
 * @param {string} rxid
 * @param {string} ts
 * @param {any} packet
 * @returns {Promise<Response|Error>} with the answer as buffer of the dns packet or error
 */
DNSResolver.prototype.resolveDnsFromCache = async function (rxid, ts, packet) {
  const k = cacheutil.makeHttpCacheKey(packet, ts);
  if (!k) throw new Error("resolver: no cache-key");

  const cr = await this.cache.get(k);
  const isAns = cr != null && dnsutil.isAnswer(cr.dnsPacket);
  const hasAns = isAns && dnsutil.hasAnswers(cr.dnsPacket);
  // if cr has answers, use probablistic expiry; otherwise prefer actual ttl
  const fresh = isAns && cacheutil.isAnswerFresh(cr.metadata, hasAns ? 0 : 6);
  this.log.d(rxid, "cache ans", k.href, "ans?", isAns, "fresh?", fresh);

  if (!isAns || !fresh) {
    return Promise.reject(new Error("resolver: cache miss"));
  }

  cacheutil.updatedAnswer(cr.dnsPacket, packet.id, cr.metadata.expiry);
  const b = dnsutil.encode(cr.dnsPacket);
  const r = new Response(b, { headers: cacheutil.cacheHeaders() });

  return Promise.resolve(r);
};
