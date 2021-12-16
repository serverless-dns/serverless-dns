/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import DNSParserWrap from "./dnsParserWrap.js";
import { LocalCache as LocalCache } from "@serverless-dns/cache-wrapper";

const flydns6 = "fdaa::3";
const ttlGraceSec = 30; //30 sec grace time for expired ttl answer
const lfuSize = 2000; // TODO: retrieve this from env
const debug = false;

export default class DNSResolver {
  constructor() {
    this.dnsParser = new DNSParserWrap();
    this.dnsResCache = false;
    this.wCache = false;
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
        this.dnsResCache = new LocalCache("dns-response-cache", lfuSize);
        if (param.runTimeEnv == "worker") {
          this.wCache = caches.default;
        }
      }
      response.data = await this.checkLocalCacheBfrResolve(param);
    } catch (e) {
      response = errResponse(e);
      console.error("Error At : DNSResolver -> RethinkModule");
      console.error(e.stack);
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
        : "").trim().toLowerCase() +
      ":" + param.requestDecodedDnsPacket.questions[0].type;
    const now = Date.now();
    let cacheRes = this.dnsResCache.Get(dn);

    if (debug) {
      console.debug("Local Cache Data", JSON.stringify(cacheRes));
    }
    if (!cacheRes || (now >= cacheRes.ttlEndTime)) {
      cacheRes = await this.checkSecondLevelCacheBfrResolve(
        param.runTimeEnv,
        param.request.url,
        dn,
        now,
      );
      if (debug) {
        console.debug("Cache Api Response", cacheRes);
      }
      if (!cacheRes) { // upstream if not in both lfu (l1) and workers (l2) cache
        cacheRes = {};
        resp.responseBodyBuffer = await this.resolveDnsUpdateCache(
          param,
          cacheRes,
          dn,
          now,
        );
        if (debug) {
          console.debug("resolve update response", cacheRes);
        }
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
      now,
    );
    return resp;
  }

  loadDnsResponseFromCache(decodedDnsPacket, end, now) {
    const outttl = Math.max(Math.floor((end - now) / 1000), 1); // to verify ttl is not set to 0sec
    for (let answer of decodedDnsPacket.answers) {
      answer.ttl = outttl;
    }
    if (debug) {
      console.debug("ttl", (end - now), "res", JSON.stringify(decodedDnsPacket));
    }
    return this.dnsParser.Encode(decodedDnsPacket);
  }

  async checkSecondLevelCacheBfrResolve(runTimeEnv, reqUrl, dn, now) {
    if (runTimeEnv !== "worker") {
      return false;
    }

    let wCacheUrl = new URL((new URL(reqUrl)).origin + "/" + dn);
    let resp = await this.wCache.match(wCacheUrl);
    if (resp) { // cache hit
      const metaData = JSON.parse(resp.headers.get("x-rethink-metadata"));
      if (now >= metaData.ttlEndTime) {
        return false;
      }

      let cacheRes = {};
      cacheRes.decodedDnsPacket = this.dnsParser.Decode(
        await resp.arrayBuffer(),
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
    const upRes = await resolveDnsUpstream(
      param.request,
      param.dnsResolverUrl,
      param.requestBodyBuffer,
      param.runTimeEnv,
      param.cloudPlatform
    );

    if (!upRes.ok) {
      console.error("!OK", upRes.status, upRes.statusText, await upRes.text());
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
        console.error("decode fail", upRes.status, "cached:", responseBodyBuffer);
        throw e;
      }
    })();

    // TODO: only cache noerror / nxdomain responses
    // TODO: nxdomain ttls are in the authority section
    let minttl = 0;
    for (let answer of decodedDnsPacket.answers) {
      minttl = (minttl <= 0 || minttl > answer.ttl) ? answer.ttl : minttl;
    }
    minttl = Math.max(minttl + ttlGraceSec, 60); // at least 60s expiry

    cacheRes.decodedDnsPacket = decodedDnsPacket;
    cacheRes.ttlEndTime = (minttl * 1000) + now;

    if (param.runTimeEnv == "worker") { // workers cache it
      let wCacheUrl = new URL((new URL(param.request.url)).origin + "/" + dn);
      let response = new Response(responseBodyBuffer, {
        headers: {
          "Cache-Control": "s-maxage=" + minttl,
          "Content-Length": responseBodyBuffer.length,
          "Content-Type": "application/octet-stream",
          "x-rethink-metadata": JSON.stringify({
            ttlEndTime: cacheRes.ttlEndTime,
            bodyUsed: true, //used to identify response is blocked or dns response. if false then response body is empty, use blocklistinfo for dns-blocking.
            blocklistInfo: convertMapToObject(
              param.blocklistFilter.getDomainInfo(
                decodedDnsPacket.questions.length > 0
                  ? decodedDnsPacket.questions[0].name
                  : "",
              ).searchResult,
            ),
          }),
        },
        cf: { cacheTtl: minttl },
      });
      param.event.waitUntil(this.wCache.put(wCacheUrl, response));
    }
    return responseBodyBuffer;
  }
}

function convertMapToObject(map) {
  return map ? Object.fromEntries(map) : false;
}

/**
 * @param {Request} request
 * @param {String} resolverUrl
 * @param {ArrayBuffer} requestBodyBuffer
 * @param {String} runTimeEnv
 * @returns
 */
async function resolveDnsUpstream(
  request,
  resolverUrl,
  requestBodyBuffer,
  runTimeEnv,
  cloudPlatform,
) {
  try {
    let u = new URL(request.url);
    let dnsResolverUrl = new URL(resolverUrl);
    u.hostname = dnsResolverUrl.hostname; // override host, default cloudflare-dns.com
    u.pathname = dnsResolverUrl.pathname; // override path, default /dns-query
    u.port = dnsResolverUrl.port; // override port, default 443
    u.protocol = dnsResolverUrl.protocol; // override proto, default https
    const headers = {
      Accept: "application/dns-message",
    };

    if (cloudPlatform === "fly") {
      return await plaindns(requestBodyBuffer);
    }

    let newRequest;
    if (
      request.method === "GET" ||
      (runTimeEnv == "worker" && request.method === "POST")
    ) {
      u.search = "?dns=" + dnsqurl(requestBodyBuffer);
      newRequest = new Request(u.href, {
        method: "GET",
        headers: headers,
      });
    } else if (request.method === "POST") {
      newRequest = new Request(u.href, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/dns-message",
          "Content-Length": requestBodyBuffer.byteLength,
        },
        body: requestBodyBuffer,
      });
    } else {
      throw new Error("get/post requests only");
    }

    return await fetch(newRequest);
  } catch (e) {
    throw e;
  }
}

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

async function plaindns(q) {
  // dynamic imports to avoid deployment issues in workers
  // v8.dev/features/dynamic-import
  const Buffer = (await import("buffer")).Buffer;
  const bq = Buffer.from(q);
  function lookup(resolve, reject) {
    const client = (await import("dgram")).createSocket("udp6");

    client.on("message", (b, addrinfo) => {
      const res = new Response(arrayBuffer(b));
      resolve(res);
    });

    client.on("error", (err) => {
      if (err) {
        console.error("plaindns recv fail", err);
        reject(err.message);
      }
    });

    client.send(bq, 53, flydns6, (err) => {
      if (err) {
        console.error("plaindns send fail", err);
        reject(err.message);
      }
    });
  }
  return new Promise(lookup);
}

function dnsqurl(dnsq) {
  return btoa(String.fromCharCode(...new Uint8Array(dnsq)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// stackoverflow.com/a/12101012
function arraybuffer(buf) {
  const ab = new ArrayBuffer(buf.length);
  const view = new Uint8Array(ab);
  for (let i = 0; i < buf.length; i++) {
    view[i] = buf[i];
  }
  return ab;
}
