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
  constructor(blf, cache) {
    this.cache = cache;
    this.http2 = null;
    this.nodeUtil = null;
    this.transport = null;
    this.blocker = new DnsBlocker();
    this.blocklistFilter = blf;
    this.log = log.withTags("DnsResolver");
    this.preferredDohResolvers = [
      envutil.dohResolver(),
      envutil.secondaryDohResolver(),
    ];
  }

  async lazyInit() {
    if (envutil.isNode() && !this.http2) {
      this.http2 = await import("http2");
      this.log.i("created custom http2 client");
    }
    if (envutil.isNode() && !this.nodeUtil) {
      this.nodeUtil = await import("../../core/node/util.js");
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
    // when this.transport is set, do not use doh
    if (this.transport) return [];

    if (!util.emptyString(preferredByUser)) {
      return [preferredByUser];
    } else if (envutil.isWorkers()) {
      // upstream to two resolvers on workers; since egress is free,
      // faster among the 2 should help lower tail latencies at zero-cost
      return this.preferredDohResolvers;
    }
    return [envutil.dohResolver()];
  }

  async resolveDns(param) {
    const rxid = param.rxid;
    const blInfo = param.userBlocklistInfo;
    const rawpacket = param.requestBodyBuffer;
    const decodedpacket = param.requestDecodedDnsPacket;
    const userDns = param.userDnsResolverUrl;
    const dispatcher = param.dispatcher;
    const blf = this.blocklistFilter;
    // may be null or empty-obj (stamp then needs to be got from blf)
    // may be a obj { domainName: String -> blockstamps: Uint16Array }
    const stamps = param.domainBlockstamp;

    const q = await this.makeRdnsResponse(rxid, rawpacket, blf, stamps);

    this.blocker.blockQuestion(rxid, /* out*/ q, blInfo);
    this.log.d(rxid, blInfo, "question blocked?", q.isBlocked);

    if (q.isBlocked) {
      this.primeCache(rxid, q, dispatcher);
      return q;
    }

    const res1 = this.resolveDnsFromCache(rxid, decodedpacket);
    const res2 = this.resolveDnsUpstream(
      rxid,
      param.request,
      this.determineDohResolvers(userDns),
      rawpacket
    );

    const res = await Promise.any([res1, res2]);

    if (!res) throw new Error(rxid + "no upstream result");

    if (!res.ok) {
      const txt = await res.text();
      this.log.d(rxid, "!OK", res.status, res.statusText, txt);
      throw new Error(ans.status + " http err: " + res.statusText);
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
  query
) {
  // if no doh upstreams set, resolve over plain-old dns
  if (util.emptyArray(resolverUrls)) {
    const q = bufutil.bufferOf(query);

    let ans = await this.transport.udpquery(rxid, q);
    if (dnsutil.truncated(ans)) {
      this.log.w(rxid, "ans truncated, retrying over tcp");
      ans = await this.transport.tcpquery(rxid, q);
    }

    return ans ? new Response(bufutil.arrayBufferOf(ans)) : util.respond503();
  }

  const promisedRes = [Promise.reject(new Error("no upstream"))];
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
      return Promise.reject(new Error("get/post requests only"));
    }
    promisedRes.push(this.http2 ? this.doh2(rxid, dnsreq) : fetch(dnsreq));
  }
  // Promise.any returns any rejected promise if none resolved; node v15+
  return Promise.any(promisedRes);
};

DNSResolver.prototype.resolveDnsFromCache = async function (rxid, packet) {
  const k = cacheutil.makeHttpCacheKey(packet);
  if (!k) throw new Error("resolver: no cache-key");

  const cr = await this.cache.get(k);
  const hasAns = dnsutil.isAnswer(cr.dnsPacket);
  const freshAns = cacheutil.isAnswerFresh(cr.metadata);
  this.log.d(rxid, "cache ans", k.href, "ans?", hasAns, "fresh?", freshAns);

  if (!hasAns || !freshAns) {
    throw new Error("resolver: cache miss");
  }

  cacheutil.updatedAnswer(cr.dnsPacket, packet.id);
  const b = dnsutil.encode(cr.dnsPacket);

  return new Response(b, { headers: cacheutil.cacheHeaders() });
};

/**
 * Resolve DNS request using HTTP/2 API of Node.js
 * @param {String} rxid - request id
 * @param {Request} request - Request object
 * @returns {Promise<Response>}
 */
DNSResolver.prototype.doh2 = async function (rxid, request) {
  if (!this.http2 || !this.nodeUtil) {
    throw new Error("h2 / node-util not setup, bailing");
  }

  this.log.d(rxid, "upstream with doh2");
  const http2 = this.http2;
  const transformPseudoHeaders = this.nodeUtil.transformPseudoHeaders;

  const u = new URL(request.url);
  const upstreamQuery = bufutil.bufferOf(await request.arrayBuffer());
  const headers = util.copyHeaders(request);

  return new Promise((resolve, reject) => {
    // TODO: h2 conn re-use: archive.is/XXKwn
    // TODO: h2 conn pool
    const authority = u.origin;
    const c = http2.connect(authority);

    c.on("error", (err) => {
      reject(err.message);
    });

    const req = c.request({
      [http2.constants.HTTP2_HEADER_METHOD]: request.method,
      [http2.constants.HTTP2_HEADER_PATH]: `${u.pathname}`,
      ...headers,
    });

    req.on("response", (headers) => {
      const b = [];
      req.on("data", (chunk) => {
        b.push(chunk);
      });
      req.on("end", () => {
        const rb = bufutil.concatBuf(b);
        const h = transformPseudoHeaders(headers);
        util.safeBox(c.close);
        resolve(new Response(rb, h));
      });
    });
    // nodejs' async err events go unhandled when the handler
    // is not registered, which ends up killing the process
    req.on("error", (err) => {
      reject(err.message);
    });

    // req.end write query to upstream over http2.
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
