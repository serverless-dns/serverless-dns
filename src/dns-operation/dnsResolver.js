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
import { LocalCache as LocalCache } from "../cache-wrapper/cache-wrapper.js";
import * as util from "../helpers/util.js";

const quad1 = "1.1.1.2";
const ttlGraceSec = 30; //30 sec grace time for expired ttl answer
const dnsCacheSize = 10000; // 10_000; // TODO: retrieve this from env

export default class DNSResolver {
  constructor() {
    this.dnsParser = new DNSParserWrap();
    this.dnsResCache = false;
    this.wCache = false;
    this.http2 = null;
    this.transport = null;
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
    let response = emptyResponse();
    try {
      if (!this.dnsResCache) {
        this.dnsResCache = new LocalCache("dns-response-cache", dnsCacheSize);
        if (isWorkers()) {
          this.wCache = caches.default;
        }
      }
      response.data = await this.checkLocalCacheBfrResolve(param);
    } catch (e) {
      response = errResponse(e);
      log.e("Error At : DNSResolver -> RethinkModule", e);
    }
    return response;
  }
  /**
   * @param {Object} param
   * @returns
   */
  async checkLocalCacheBfrResolve(param) {
    let resp = {};
    const dn =
      (param.requestDecodedDnsPacket.questions.length > 0
        ? param.requestDecodedDnsPacket.questions[0].name
        : ""
      )
        .trim()
        .toLowerCase() +
      ":" +
      param.requestDecodedDnsPacket.questions[0].type;
    const now = Date.now();
    let cacheRes = this.dnsResCache.Get(dn);

    log.d("Local Cache Data", JSON.stringify(cacheRes));
    if (!cacheRes || now >= cacheRes.ttlEndTime) {
      cacheRes = await this.checkSecondLevelCacheBfrResolve(
        param.runTimeEnv,
        param.request.url,
        dn,
        now
      );
      log.d("CacheApi response", cacheRes);

      // upstream if not in both lfu (l1) and workers (l2) cache
      if (!cacheRes) {
        cacheRes = {};
        resp.responseBodyBuffer = await this.resolveDnsUpdateCache(
          param,
          cacheRes,
          dn,
          now
        );
        log.d("resolver response", JSON.stringify(cacheRes));
        resp.responseDecodedDnsPacket = cacheRes.decodedDnsPacket;
        this.dnsResCache.Put(dn, cacheRes);
        return resp;
      }
      this.dnsResCache.Put(dn, cacheRes);
    }

    resp.responseDecodedDnsPacket = cacheRes.decodedDnsPacket;
    resp.responseDecodedDnsPacket.id = param.requestDecodedDnsPacket.id;
    resp.responseBodyBuffer = this.loadDnsResponseFromCache(
      cacheRes.decodedDnsPacket,
      cacheRes.ttlEndTime,
      now
    );

    return resp;
  }

  loadDnsResponseFromCache(decodedDnsPacket, end, now) {
    const outttl = Math.max(Math.floor((end - now) / 1000), 1); // to verify ttl is not set to 0sec
    for (let answer of decodedDnsPacket.answers) {
      answer.ttl = outttl;
    }
    log.d("ttl", end - now, "res", JSON.stringify(decodedDnsPacket));
    return this.dnsParser.Encode(decodedDnsPacket);
  }

  async checkSecondLevelCacheBfrResolve(runTimeEnv, reqUrl, dn, now) {
    if (!isWorkers()) return false;

    let wCacheUrl = new URL(new URL(reqUrl).origin + "/" + dn);
    let resp = await this.wCache.match(wCacheUrl);
    if (resp) {
      // cache hit
      const metaData = JSON.parse(resp.headers.get("x-rethink-metadata"));
      if (now >= metaData.ttlEndTime) {
        return false;
      }

      let cacheRes = {};
      cacheRes.decodedDnsPacket = this.dnsParser.Decode(
        await resp.arrayBuffer()
      );
      cacheRes.ttlEndTime = metaData.ttlEndTime;
      return cacheRes;
    }
  }

  /**
   * @param {Object} param
   * @param {Object} cacheRes
   * @param {String} dn
   * @returns
   */
  async resolveDnsUpdateCache(param, cacheRes, dn, now) {
    /**
     * @type {Response}
     */
    const upRes = await this.resolveDnsUpstream(
      param.request,
      param.dnsResolverUrl,
      param.requestBodyBuffer
    );

    if (!upRes) throw new Error("no upstream result");

    if (!upRes.ok) {
      log.d("!OK", upRes.status, upRes.statusText, await upRes.text());
      throw new Error(upRes.status + " http err: " + upRes.statusText);
    }

    let responseBodyBuffer = await upRes.arrayBuffer();

    if (!responseBodyBuffer || responseBodyBuffer.byteLength < 12 + 5) {
      throw new Error("Null / inadequate response from upstream");
    }

    let decodedDnsPacket = (() => {
      try {
        return this.dnsParser.Decode(responseBodyBuffer);
      } catch (e) {
        log.e("decode fail " + upRes.status + " cache? " + responseBodyBuffer);
        throw e;
      }
    })();

    // TODO: only cache noerror / nxdomain responses
    // TODO: nxdomain ttls are in the authority section
    let minttl = 0;
    for (let answer of decodedDnsPacket.answers) {
      minttl = minttl <= 0 || minttl > answer.ttl ? answer.ttl : minttl;
    }
    minttl = Math.max(minttl + ttlGraceSec, 60); // at least 60s expiry

    cacheRes.decodedDnsPacket = decodedDnsPacket;
    cacheRes.ttlEndTime = minttl * 1000 + now;

    // workers cache it
    if (isWorkers()) {
      let wCacheUrl = new URL(new URL(param.request.url).origin + "/" + dn);
      let response = new Response(responseBodyBuffer, {
        headers: {
          "Content-Length": responseBodyBuffer.length,
          "x-rethink-metadata": JSON.stringify(
            cacheMetadata(cacheRes, param.blocklistFilter)
          ),
        },
        cf: { cacheTtl: 604800 },
      });

      util.dnsHeaders(response);
      param.event.waitUntil(this.wCache.put(wCacheUrl, response));
    }
    return responseBodyBuffer;
  }
}

function cacheMetadata(cacheRes, blocklistFilter) {
  const question =
    cacheRes.decodedDnsPacket.questions.length > 0
      ? cacheRes.decodedDnsPacket.questions[0].name
      : "";
  return {
    ttlEndTime: cacheRes.ttlEndTime,
    bodyUsed: true,
    blocklistInfo: objOf(blocklistFilter.getDomainInfo(question).searchResult),
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
    if (isNode() && onFly()) {
      if (!this.transport)
        this.transport = new (
          await import("../helpers/node/dns-transport.js")
        ).Transport(quad1, 53);

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
      (isWorkers() && request.method === "POST")
    ) {
      u.search = "?dns=" + dnsqurl(requestBodyBuffer);
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

    return isNode() ? this.doh2(newRequest) : fetch(newRequest);
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
  if (!this.http2) this.http2 = await import("http2");
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

function emptyResponse() {
  return {
    isException: false,
    exceptionStack: "",
    exceptionFrom: "",
    data: {
      responseDecodedDnsPacket: null,
      responseBodyBuffer: null,
    },
  };
}

function errResponse(e) {
  return {
    isException: true,
    exceptionStack: e.stack,
    exceptionFrom: "DNSResolver RethinkModule",
    data: false,
  };
}

function dnsqurl(dnsq) {
  return btoa(String.fromCharCode(...new Uint8Array(dnsq)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function onFly() {
  return env.cloudPlatform === "fly";
}

function isWorkers() {
  return env.runTimeEnv === "worker";
}

function isNode() {
  return env.runTimeEnv === "node";
}

function objOf(map) {
  return map ? Object.fromEntries(map) : false;
}
