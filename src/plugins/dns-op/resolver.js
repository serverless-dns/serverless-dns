/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import { DnsBlocker } from "./blocker.js";
import * as pres from "../plugin-response.js";
import * as rdnsutil from "../rdns-util.js";
import * as cacheutil from "../cache-util.js";
import * as dnsutil from "../../commons/dnsutil.js";
import * as bufutil from "../../commons/bufutil.js";
import * as util from "../../commons/util.js";
import * as envutil from "../../commons/envutil.js";

export default class DNSResolver {
  /**
   * @param {import("../rethinkdns/main.js").BlocklistWrapper} blocklistWrapper
   * @param {import("./cache.js").DnsCache} cache
   */
  constructor(blocklistWrapper, cache) {
    /** @type {import("./cache.js").DnsCache} */
    this.cache = cache;
    this.blocker = new DnsBlocker();
    /** @type {import("../rethinkdns/main.js").BlocklistWrapper} */
    this.bw = blocklistWrapper;
    this.http2 = null;
    this.nodeutil = null;
    this.transport = null;
    this.log = log.withTags("DnsResolver");

    this.measurements = [];
    this.profileResolve = envutil.profileDnsResolves();
    // only valid on nodejs
    this.forceDoh = envutil.forceDoh();
    this.avoidFetch = envutil.avoidFetch();

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
      this.log.w("doh?", this.forceDoh, "fetch?", this.avoidFetch);
    }
  }

  async lazyInit() {
    if (!envutil.hasDynamicImports()) return;

    const isnode = envutil.isNode();
    const plainOldDnsIp = dnsutil.dnsaddr();
    if (isnode && !this.http2) {
      this.http2 = await import("http2");
      this.log.i("imported custom http2 client");
    }
    if (isnode && !this.nodeutil) {
      this.nodeutil = await import("../../core/node/util.js");
      this.log.i("imported node-util");
    }
    if (isnode && !this.transport) {
      // awaiting on dns-transport takes a tad longer that more than 1 event
      // awaiting lazyInit() trigger this part of the code and end up
      // initializing multiple transports. This reproduces easily when 100+
      // requests arrive at once.
      const dnst = await import("../../core/node/dns-transport.js");
      if (this.transport == null) {
        this.transport = dnst.makeTransport(plainOldDnsIp, 53);
        this.log.i("imported udp/tcp dns transport", plainOldDnsIp);
      }
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
    await this.lazyInit();
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
   * @param {Object} ctx.userBlocklistInfo
   * @param {String} ctx.userDnsResolverUrl
   * @param {string} ctx.userBlockstamp
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
    const dispatcher = ctx.dispatcher;
    const userBlockstamp = ctx.userBlockstamp;
    // may be null or empty-obj (stamp then needs to be got from blf)
    // may be a obj { domainName: String -> blockstamps: Uint16Array }
    const stamps = ctx.domainBlockstamp;

    let blf = this.bw.getBlocklistFilter();
    const isBlfDisabled = this.bw.disabled();
    let isBlfSetup = rdnsutil.isBlocklistFilterSetup(blf);

    // if both blocklist-filter (blf) and stamps are not setup, question-block
    // is a no-op, while we expect answer-block to catch the block regardless.
    const q = await this.makeRdnsResponse(rxid, rawpacket, blf, stamps);

    this.blocker.blockQuestion(rxid, /* out*/ q, blInfo);
    this.log.d(rxid, "q block?", q.isBlocked, "blf?", isBlfSetup);

    if (q.isBlocked) {
      this.primeCache(rxid, q, dispatcher);
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
          req,
          this.determineDohResolvers(userDns),
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
      this.log.d(rxid, "!OK", res.status, txt);
      throw new Error(txt + " http err: " + res);
    }

    const ans = await res.arrayBuffer();

    const r = await this.makeRdnsResponse(rxid, ans, blf, stamps);

    // blockAnswer is a no-op if the ans is already quad0
    // check outgoing cached dns-packet against blocklists
    this.blocker.blockAnswer(rxid, /* out*/ r, blInfo);
    const fromCache = cacheutil.hasCacheHeader(res.headers);
    this.log.d(rxid, "ans block?", r.isBlocked, "from cache?", fromCache);

    // if res was got from caches or if res was got from max doh (ie, blf
    // wasn't used to retrieve stamps), then skip hydrating the cache
    if (!fromCache && !fromMax) {
      this.primeCache(rxid, r, dispatcher);
    }
    return r;
  }

  async makeRdnsResponse(rxid, raw, blf, stamps = null) {
    if (!raw) throw new Error(rxid + " mk-res no upstream result");

    const dnsPacket = dnsutil.decode(raw);
    // stamps are empty for domains that are not in any blocklist
    // but there's no way to know if that was indeed the case as
    // stamps are sent here by cache-resolver, which may or may not
    // have retrieved the stamps in the first-place.
    stamps = util.emptyObj(stamps)
      ? rdnsutil.blockstampFromBlocklistFilter(dnsPacket, blf)
      : stamps;

    return pres.dnsResponse(dnsPacket, raw, stamps);
  }

  primeCache(rxid, r, dispatcher) {
    const blocked = r.isBlocked;

    const k = cacheutil.makeHttpCacheKey(r.dnsPacket);

    this.log.d(rxid, "primeCache: block?", blocked, "k", k.href);

    if (!k) {
      this.log.d(rxid, "no cache-key, url/query missing?", k, r.stamps);
      return;
    }

    const v = cacheutil.cacheValueOf(r);

    this.cache.put(k, v, dispatcher);
  }

  ofMax(blockstamp) {
    if (util.emptyString(blockstamp)) return this.maxDoh;
    else return this.maxDoh + blockstamp;
  }
}

/**
 * @param {String} rxid
 * @param {Request} request
 * @param {Array} resolverUrls
 * @param {ArrayBuffer} query
 * @param {any} packet
 * @returns {Promise<Response|Error>}
 */
DNSResolver.prototype.resolveDnsUpstream = async function (
  rxid,
  request,
  resolverUrls,
  query,
  packet
) {
  // Promise.any on promisedPromises[] only works if there are
  // zero awaits in this function or any of its downstream calls.
  // Otherwise, the first reject in promisedPromises[], before
  // any statement in the call-stack awaits, would throw unhandled
  // error, since the event loop would have 'ticked' and Promise.any
  // on promisedPromises[] would still not have been executed, as it
  // is the last statement of this function (which would have eaten up
  // all rejects as long as there was one resolved promise).
  const promisedPromises = [];

  // if no doh upstreams set, resolve over plain-old dns
  if (util.emptyArray(resolverUrls)) {
    // do not let exceptions passthrough to the caller
    try {
      const q = bufutil.bufferOf(query);

      let ans = await this.transport.udpquery(rxid, q);
      if (dnsutil.truncated(ans)) {
        this.log.w(rxid, "ans truncated, retrying over tcp");
        ans = await this.transport.tcpquery(rxid, q);
      }

      if (ans) {
        const r = new Response(bufutil.arrayBufferOf(ans));
        promisedPromises.push(Promise.resolve(r));
      } else {
        promisedPromises.push(Promise.resolve(util.respond503()));
      }
    } catch (e) {
      this.log.e(rxid, "err when querying plain old dns", e.stack);
      promisedPromises.push(Promise.reject(e));
    }

    return Promise.any(promisedPromises);
  }

  try {
    // upstream to cache
    this.log.d(rxid, "upstream cache");
    promisedPromises.push(this.resolveDnsFromCache(rxid, packet));

    // upstream to resolvers
    for (const rurl of resolverUrls) {
      if (util.emptyString(rurl)) {
        this.log.w(rxid, "missing resolver url", rurl);
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
        });
      } else if (util.isPostRequest(request)) {
        dnsreq = new Request(u.href, {
          method: "POST",
          headers: util.concatHeaders(
            util.contentLengthHeader(query),
            util.dnsHeaders()
          ),
          body: query,
        });
      } else {
        throw new Error("get/post only");
      }
      this.log.d(rxid, "upstream doh2/fetch", u.href);
      promisedPromises.push(
        this.avoidFetch ? this.doh2(rxid, dnsreq) : fetch(dnsreq)
      );
    }
  } catch (e) {
    this.log.e(rxid, "err doh2/fetch upstream", e.stack);
    promisedPromises.push(Promise.reject(e));
  }

  // Promise.any returns any rejected promise if none resolved; node v15+
  return Promise.any(promisedPromises);
};

DNSResolver.prototype.resolveDnsFromCache = async function (rxid, packet) {
  const k = cacheutil.makeHttpCacheKey(packet);
  if (!k) throw new Error("resolver: no cache-key");

  const cr = await this.cache.get(k);
  const hasAns = cr && dnsutil.isAnswer(cr.dnsPacket);
  const freshAns = hasAns && cacheutil.isAnswerFresh(cr.metadata);
  this.log.d(rxid, "cache ans", k.href, "ans?", hasAns, "fresh?", freshAns);

  if (!hasAns || !freshAns) {
    return Promise.reject(new Error("resolver: cache miss"));
  }

  cacheutil.updatedAnswer(cr.dnsPacket, packet.id, cr.metadata.expiry);
  const b = dnsutil.encode(cr.dnsPacket);
  const r = new Response(b, { headers: cacheutil.cacheHeaders() });

  return Promise.resolve(r);
};

/**
 * Resolve DNS request using HTTP/2 API of Node.js
 * @param {String} rxid - request id
 * @param {Request} request - Request object
 * @returns {Promise<Response>}
 */
DNSResolver.prototype.doh2 = async function (rxid, request) {
  if (!this.http2 || !this.nodeutil) {
    throw new Error("h2 / node-util not setup, bailing");
  }

  this.log.d(rxid, "upstream with doh2");
  const http2 = this.http2;

  const u = new URL(request.url); // doh.tld/dns-query/?dns=b64
  const verb = request.method; // GET or POST
  const path = util.isGetRequest(request)
    ? u.pathname + u.search // /dns-query/?dns=b64
    : u.pathname; // /dns-query
  const qab = await request.arrayBuffer(); // empty for GET
  const upstreamQuery = bufutil.bufferOf(qab);
  const headers = util.copyHeaders(request);

  return new Promise((resolve, reject) => {
    // TODO: h2 conn re-use: archive.is/XXKwn
    // TODO: h2 conn pool
    if (!util.isGetRequest(request) && !util.isPostRequest(request)) {
      reject(new Error("Only GET/POST requests allowed"));
    }

    const c = http2.connect(u.origin);

    c.on("error", (err) => {
      this.log.e(rxid, "conn fail", err.message);
      reject(err.message);
    });

    const req = c.request({
      [http2.constants.HTTP2_HEADER_METHOD]: verb,
      [http2.constants.HTTP2_HEADER_PATH]: path,
      ...headers,
    });

    req.on("response", (headers) => {
      const b = [];
      req.on("data", (chunk) => {
        b.push(chunk);
      });
      req.on("end", () => {
        const rb = bufutil.concatBuf(b);
        const h = this.nodeutil.transformPseudoHeaders(headers);
        util.safeBox(() => c.close());
        resolve(new Response(rb, h));
      });
    });
    // nodejs' async err events go unhandled when the handler
    // is not registered, which ends up killing the process
    req.on("error", (err) => {
      this.log.e(rxid, "send/recv fail", err.message);
      reject(err.message);
    });

    // req.end writes query to upstream over http2.
    // do this only after the event-handlers (response,
    // on, end, error etc) have been registered (above),
    // and not before. Those events aren't resent by
    // nodejs; while they may in fact happen immediately
    // post a req.write / req.end (for ex: an error if it
    // happens pronto, before an event-handler could be
    // registered, then the err would simply go unhandled)
    req.end(upstreamQuery);
  });
};
