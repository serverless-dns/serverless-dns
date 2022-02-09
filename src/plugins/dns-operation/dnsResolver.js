/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import { DnsBlocker } from "./dnsBlock.js";
import * as rdnsutil from "../dnsblockutil.js";
import * as cacheutil from "../cacheutil.js";
import * as dnsutil from "../../commons/dnsutil.js";
import * as bufutil from "../../commons/bufutil.js";
import * as util from "../../commons/util.js";
import * as envutil from "../../commons/envutil.js";

export default class DNSResolver {
  constructor(blocklistWrapper, cache) {
    this.cache = cache;
    this.http2 = null;
    this.nodeutil = null;
    this.transport = null;
    this.blocker = new DnsBlocker();
    this.bw = blocklistWrapper;
    this.log = log.withTags("DnsResolver");

    this.measurements = [];
    this.profileResolve = envutil.profileDnsResolves();
    // only valid on nodejs
    this.forceDoh = envutil.forceDoh();
    this.avoidFetch = envutil.avoidFetch();

    if (this.profileResolve) {
      this.log.w("profiling", this.determineDohResolvers());
      this.log.w("doh?", this.forceDoh, "fetch?", this.avoidFetch);
    }
  }

  async lazyInit() {
    if (!envutil.hasDynamicImports()) return;

    if (envutil.isNode() && !this.http2) {
      this.http2 = await import("http2");
      this.log.i("created custom http2 client");
    }
    if (envutil.isNode() && !this.nodeutil) {
      this.nodeutil = await import("../../core/node/util.js");
      this.log.i("imported node-util");
    }
    if (envutil.isNode() && !this.transport) {
      const plainOldDnsIp = dnsutil.dnsIpv4();
      this.transport = new (
        await import("../../core/node/dns-transport.js")
      ).Transport(plainOldDnsIp, 53);
      this.log.i("created udp/tcp dns transport", plainOldDnsIp);
    }
  }

  /**
   * @param {Object} param
   * @param {String} param.rxid
   * @param {Request} param.request
   * @param {ArrayBuffer} param.requestBodyBuffer
   * @param {String} param.userDnsResolverUrl
   * @param {Object} param.requestDecodedDnsPacket
   * @returns
   */
  async RethinkModule(param) {
    await this.lazyInit();
    let response = util.emptyResponse();

    try {
      response.data = await this.resolveDns(param);
    } catch (e) {
      response = util.errResponse("dnsResolver", e);
      this.log.e(param.rxid, "main", e.stack);
    }

    return response;
  }

  determineDohResolvers(preferredByUser) {
    // when this.transport is set, do not use doh unless forced
    if (this.transport && !this.forceDoh) return [];

    if (!util.emptyString(preferredByUser)) {
      return [preferredByUser];
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

  async resolveDns(param) {
    const rxid = param.rxid;
    const blInfo = param.userBlocklistInfo;
    const rawpacket = param.requestBodyBuffer;
    const decodedpacket = param.requestDecodedDnsPacket;
    const userDns = param.userDnsResolverUrl;
    const dispatcher = param.dispatcher;
    // may be null or empty-obj (stamp then needs to be got from blf)
    // may be a obj { domainName: String -> blockstamps: Uint16Array }
    const stamps = param.domainBlockstamp;

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
    const promisedTasks = await Promise.all([
      this.bw.init(rxid),
      this.resolveDnsUpstream(
        rxid,
        param.request,
        this.determineDohResolvers(userDns),
        rawpacket,
        decodedpacket
      ),
    ]);

    if (this.profileResolve) {
      resolveEnd = Date.now();
      this.measurements.push(resolveEnd - resolveStart);
      this.logMeasurementsPeriodically();
    }

    const res = promisedTasks[1];

    if (!isBlfDisabled && !isBlfSetup) {
      this.log.d(rxid, "blocklist-filter downloaded and setup");
      blf = this.bw.getBlocklistFilter();
      isBlfSetup = rdnsutil.isBlocklistFilterSetup(blf);
    } else {
      isBlfSetup = true; // override, as blocklists disabled
    }

    if (!isBlfSetup) throw new Error(rxid + " no blocklist-filter");
    if (!res) throw new Error(rxid + " no upstream result");

    if (!res.ok) {
      const txt = res.text && (await res.text());
      this.log.d(rxid, "!OK", res, txt);
      throw new Error(txt + " http err: " + res);
    }

    const ans = await res.arrayBuffer();

    const r = await this.makeRdnsResponse(rxid, ans, blf, stamps);

    // check outgoing cached dns-packet against blocklists
    this.blocker.blockAnswer(rxid, /* out*/ r, blInfo);
    const fromCache = cacheutil.hasCacheHeader(res.headers);
    this.log.d(rxid, "ans block?", r.isBlocked, "from cache?", fromCache);

    // res was already fetched from caches...
    if (!fromCache) {
      this.primeCache(rxid, r, dispatcher);
    }
    return r;
  }

  async makeRdnsResponse(rxid, raw, blf, stamps = null) {
    if (!raw) throw new Error(rxid + " mk-res no upstream result");

    const dnsPacket = dnsutil.decode(raw);
    // stamps are empty for domains that are not in any blocklist
    // but there's no way to know if that was indeed the case as
    // stamps are sent here by cacheResolver, which may or may not
    // have retrieved the stamps in the first-place (in which case
    // these would be empty, regardless of whether the domain was
    // in any of the blocklists or not).
    stamps = util.emptyObj(stamps)
      ? rdnsutil.blockstampFromBlocklistFilter(dnsPacket, blf)
      : stamps;

    return rdnsutil.dnsResponse(dnsPacket, raw, stamps);
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
}

/**
 * @param {String} rxid
 * @param {Request} request
 * @param {Array} resolverUrls
 * @param {ArrayBuffer} query
 * @returns
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
