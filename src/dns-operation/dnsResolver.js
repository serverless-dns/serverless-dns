/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { Buffer } from "buffer";
import DNSParserWrap from "./dnsParserWrap.js";
import * as dnsutil from "../helpers/dnsutil.js";
import * as envutil from "../helpers/envutil.js";
import { LocalCache as LocalCache } from "../cache-wrapper/cache-wrapper.js";
import * as util from "../helpers/util.js";

const quad1 = "1.1.1.2";
const ttlGraceSec = 30; //30 sec grace time for expired ttl answer
const dnsCacheSize = 10000; // 10_000; // TODO: retrieve this from env
const httpCacheTtl = 604800; // 1w

export default class DNSResolver {
  constructor() {
    this.dnsParser = new DNSParserWrap();
    this.dnsResCache = null;
    this.httpCache = null;
    this.http2 = null;
    this.transport = null;
  }

  async lazyInit() {
    if (!this.dnsResCache) {
      this.dnsResCache = new LocalCache("dns-response-cache", dnsCacheSize);
    }
    if (envutil.isWorkers() && !this.httpCache) {
      this.httpCache = caches.default;
    }
    if (envutil.isNode() && !this.http2) {
      this.http2 = await import("http2");
    }
    if (envutil.isNode() && !this.transport) {
      this.transport = new (
        await import("../helpers/node/dns-transport.js")
      ).Transport(quad1, 53);
    }
  }

  /**
   * @param {Object} param
   * @param {Request} param.request
   * @param {ArrayBuffer} param.requestBodyBuffer
   * @param {String} param.dnsResolverUrl
   * @param {String} param.runTimeEnv
   * @param {DnsDecodeObject} param.requestDecodedDnsPacket
   * @param {Worker-Event} param.event
   * @param {} param.blocklistFilter
   * @returns
   */
  async RethinkModule(param) {
    await this.lazyInit();
    let response = util.emptyResponse();
    try {
      response.data = await this.resolveRequest(param);
    } catch (e) {
      response = util.errResponse("dnsResolver", e);
      log.e("Err DNSResolver -> RethinkModule", e);
    }
    return response;
  }

  async resolveRequest(param) {
    let cres = await this.resolveFromCache(param);

    if (!cres) {
      // never returns null, may return false
      cres = await this.upstreamQuery(param);
      util.safeBox(() => {
        this.updateCachesIfNeeded(param, cres);
      });
    }

    if (!cres) {
      throw new Error("No answer from cache or upstream", cres);
    }

    return {
      responseBodyBuffer: cres.dnsPacket,
      responseDecodedDnsPacket: cres.decodedDnsPacket,
    };
  }

  /**
   * @param {Object} param
   * @returns
   */
  async resolveFromCache(param) {
    const key = this.cacheKey(param.requestDecodedDnsPacket);
    const qid = param.requestDecodedDnsPacket.id;

    if (!key) return null;

    let cacheRes = this.resolveFromLocalCache(qid, key);

    if (!cacheRes) {
      cacheRes = await this.resolveFromHttpCache(qid, key);
      this.updateLocalCacheIfNeeded(key, cacheRes);
    }

    return cacheRes;
  }

  resolveFromLocalCache(queryId, key) {
    const cacheRes = this.dnsResCache.Get(key);
    if (!cacheRes) return false; // cache-miss

    return this.makeCacheResponse(queryId, cacheRes.dnsPacket, cacheRes.ttlEndTime);
  }

  async resolveFromHttpCache(queryId, key) {
    if (!this.httpCache) return false; // no http-cache

    const hKey = this.httpCacheKey(param.request.url, key);
    const resp = await this.httpCache.match(hKey);

    if (!resp) return false; // cache-miss

    const metadata = JSON.parse(resp.headers.get("x-rethink-metadata"));
    const dnsPacket = await resp.arrayBuffer();

    return this.makeCacheResponse(queryId, dnsPacket, metadata.ttlEndTime);
  }

  makeCacheResponse(queryId, dnsPacket, expiry = null) {
    const decodedDnsPacket = util.safeBox(() => {
      return this.dnsParser.Decode(dnsPacket);
    });

    if (!decodedDnsPacket) { // can't decode
      log.d("mkcache decode failed", expiry);
      return false;
    }

    if (expiry === null) {
      expiry = this.determineCacheExpiry(decodedDnsPacket);
    }

    if (expiry < Date.now()) { // stale, expired entry
      log.d("mkcache stale", expiry)
      return false;
    }

    this.updateTtl(decodedDnsPacket, expiry);
    this.updateQueryId(decodedDnsPacket, queryId);

    const updatedDnsPacket = util.safeBox(() => {
      return this.dnsParser.Encode(decodedDnsPacket);
    })

    if (!updatedDnsPacket) { // can't re-encode
      log.w("mkcache encode failed", decodedDnsPacket, expiry);
      return false;
    }

    const cacheRes = {
      dnsPacket: updatedDnsPacket,
      decodedDnsPacket : decodedDnsPacket,
      ttlEndTime: expiry,
    }

    return cacheRes;
  }

  async updateCachesIfNeeded(param, cacheRes) {
    if (!cacheRes) return;

    const k = this.cacheKey(param.requestDecodedDnsPacket);
    if (!k) return;

    this.updateLocalCacheIfNeeded(k, cacheRes);
    this.updateHttpCacheIfNeeded(param, k, cacheRes);
  }

  updateLocalCacheIfNeeded(k, v) {
    if (!k || !v) return; // nothing to cache

    // strike out redundant decoded packet
    const nv = {
      dnsPacket : v.dnsPacket,
      ttlEndTime : v.ttlEndTime,
    }

    this.dnsResCache.Put(k, nv);
  }

  updateHttpCacheIfNeeded(param, k, cacheRes) {
    if (!this.httpCache) return; // only on Workers
    if (!k || !cacheRes) return; // nothing to cache

    const cacheUrl = this.httpCacheKey(param.request.url, k);
    const value = new Response(cacheRes.dnsPacket, {
      headers: {
        "Content-Length": cacheRes.dnsPacket.byteLength,
        "x-rethink-metadata": JSON.stringify(
          this.httpCacheMetadata(cacheRes, param.blocklistFilter)
        ),
      },
      cf: { cacheTtl: httpCacheTtl },
    });

    util.dnsHeaders(value);
    param.event.waitUntil(this.httpCache.put(cacheUrl, value));
  }

  /**
   * @param {Object} param
   * @param {Object} cacheRes
   * @param {String} dn
   * @returns
   */
  async upstreamQuery(param) {
    /**
     * @type {Response}
     */
    const upRes = await this.resolveDnsUpstream(
      param.request,
      param.dnsResolverUrl,
      param.requestBodyBuffer
    );

    if (!upRes) throw new Error("no upstream result"); // no answer

    if (!upRes.ok) { // serv-fail
      log.d("!OK", upRes.status, upRes.statusText, await upRes.text());
      throw new Error(upRes.status + " http err: " + upRes.statusText);
    }

    const dnsPacket = await upRes.arrayBuffer();

    if (!dnsutil.validResponseSize(dnsPacket)) { // invalid answer
      throw new Error("inadequate response from upstream");
    }

    const queryId = param.requestDecodedDnsPacket.id;

    return this.makeCacheResponse(queryId, dnsPacket);
  }

  determineCacheExpiry(decodedDnsPacket) {
    const expiresImmediately = 0; // no caching
    // only noerror ans are cached, that means nxdomain
    // and ans with other rcodes are not cached at all.
    // btw, nxdomain ttls are in the authority section
    if (!dnsutil.rcodeNoError(decodedDnsPacket)) return expiresImmediately;

    // if there are zero answers, there's nothing to cache
    if (!dnsutil.hasAnswers(decodedDnsPacket)) return expiresImmediately;

    // set min(ttl) among all answers, but at least ttlGraceSec
    let minttl = 1 << 30; // some abnormally high ttl
    for (let a of decodedDnsPacket.answers) {
      minttl = Math.min(a.ttl || minttl, minttl);
    }

    if (minttl === 1 << 30) return expiresImmediately;

    minttl = Math.max(minttl + ttlGraceSec, ttlGraceSec);
    const expiry = Date.now() + (minttl * 1000);

    return expiry;
  }

  cacheKey(packet) {
    // multiple questions are kind of an undefined behaviour
    // stackoverflow.com/a/55093896
    if (packet.questions.length != 1) return null;

    const name = packet.questions[0].name
        .trim()
        .toLowerCase();
    const type = packet.questions[0].type;
    return name + ":" + type;
  }

  httpCacheKey(u, p) {
    return new URL(new URL(u).origin + "/" + p);
  }

  updateQueryId(decodedDnsPacket, queryId) {
    decodedDnsPacket.id = queryId;
  }

  updateTtl(decodedDnsPacket, end) {
    const now = Date.now();
    const outttl = Math.max(Math.floor((end - now) / 1000), ttlGraceSec); // at least 30s
    for (let a of decodedDnsPacket.answers) {
      if (!dnsutil.optAnswer(a)) a.ttl = outttl;
    }
  }

}

function httpCacheMetadata(cacheRes, blFilter) {
  // multiple questions are kind of an undefined behaviour
  // stackoverflow.com/a/55093896
  if (cacheRes.decodedDnsPacket.questions.length !== 1) {
    throw new Error("cache expects just the one dns question");
  }

  const name = cacheRes.decodedDnsPacket.questions[0].name
  return {
    ttlEndTime: cacheRes.ttlEndTime,
    bodyUsed: true,
    // TODO: Why not store blocklist-info in LocalCache?
    blocklistInfo: util.objOf(blFilter.getDomainInfo(name).searchResult),
  };
}

/**
 * @param {Request} request
 * @param {String} resolverUrl
 * @param {ArrayBuffer} requestBodyBuffer
 * @returns
 */
DNSResolver.prototype.resolveDnsUpstream = async function (
  request,
  resolverUrl,
  requestBodyBuffer
) {
  try {
    // for now, upstream plain-old dns on fly
    if (this.transport) {

      const q = util.bufferOf(requestBodyBuffer);

      let ans = await this.transport.udpquery(q);
      if (ans && dnsutil.truncated(ans)) {
        log.w("ans truncated, retrying over tcp");
        ans = await this.transport.tcpquery(q);
      }

      return ans
        ? new Response(util.arrayBufferOf(ans))
        : new Response(null, { status: 503 });
    }

    let u = new URL(request.url);
    let dnsResolverUrl = new URL(resolverUrl);
    u.hostname = dnsResolverUrl.hostname; // override host, default cloudflare-dns.com
    u.pathname = dnsResolverUrl.pathname; // override path, default /dns-query
    u.port = dnsResolverUrl.port; // override port, default 443
    u.protocol = dnsResolverUrl.protocol; // override proto, default https

    let newRequest = null;
    if (
      request.method === "GET" ||
      (envutil.isWorkers() && request.method === "POST")
    ) {
      u.search = "?dns=" + dnsutil.dnsqurl(requestBodyBuffer);
      newRequest = new Request(u.href, {
        method: "GET",
      });
    } else if (request.method === "POST") {
      newRequest = new Request(u.href, {
        method: "POST",
        headers: {
          "Content-Length": requestBodyBuffer.byteLength,
        },
        body: requestBodyBuffer,
      });
    } else {
      throw new Error("get/post requests only");
    }

    util.dnsHeaders(newRequest);

    return this.http2 ? this.doh2(newRequest) : fetch(newRequest);
  } catch (e) {
    throw e;
  }
};

/**
 * Resolve DNS request using HTTP/2 API of Node.js
 * @param {Request} request - Request object
 * @returns {Promise<Response>}
 */
DNSResolver.prototype.doh2 = async function (request) {
  console.debug("upstream using h2");
  const http2 = this.http2;

  const u = new URL(request.url);
  const reqB = util.bufferOf(await request.arrayBuffer());
  const headers = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });

  return new Promise((resolve, reject) => {
    // TODO: h2 connection pool
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
      const resBuffers = [];
      const resH = {};
      for (const k in headers) {
        // Transform http/2 pseudo-headers
        if (k.startsWith(":")) resH[k.slice(1)] = headers[k];
        else resH[k] = headers[k];
      }
      req.on("data", (chunk) => {
        resBuffers.push(chunk);
      });
      req.on("end", () => {
        const resB = Buffer.concat(resBuffers);
        c.close();
        resolve(new Response(resB, resH));
      });
      req.on("error", (err) => {
        reject(err.message);
      });
    });

    req.end(reqB);
  });
};

