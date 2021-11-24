/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import DNSParserWrap from "./dnsParserWrap.js";
import { LocalCache as LocalCache } from "@serverless-dns/cache-wrapper";
export default class DNSResolver {
  constructor() {
    this.dnsParser = new DNSParserWrap();
    this.dnsResCache = false;
    this.wCache = false;
  }
  /**
   * @param {*} param
   * @param {Request} param.request
   * @param {ArrayBuffer} param.requestBodyBuffer
   * @param {String} param.dnsResolverUrl
   * @param {String} param.runTimeEnv
   * @param {DnsDecodeObject} param.requestDecodedDnsPacket
   * @returns
   */
  async RethinkModule(param) {
    let response = {};
    response.isException = false;
    response.exceptionStack = "";
    response.exceptionFrom = "";
    response.data = {};
    try {
      if (!this.dnsResCache) {
        this.dnsResCache = new LocalCache(
          "dns-response-cache",
          2000,
        );
        if (param.runTimeEnv == "worker") {
          //console.log("loading worker cache")
          this.wCache = caches.default;
        }
      }
      response.data = await checkLocalCacheBfrResolve.call(
        this,
        param,
      );
    } catch (e) {
      response.isException = true;
      response.exceptionStack = e.stack;
      response.exceptionFrom = "DNSResolver RethinkModule";
      response.data = false;
      console.error("Error At : DNSResolver -> RethinkModule");
      console.error(e.stack);
    }
    return response;
  }
}

/**
 * @param {Object} param
 * @returns
 */
async function checkLocalCacheBfrResolve(param) {
  let resp = {}
  resp.responseDecodedDnsPacket = null
  resp.responseBodyBuffer = null
  const dn =
    (param.requestDecodedDnsPacket.questions.length > 0
      ? param.requestDecodedDnsPacket.questions[0].name
      : "").trim().toLowerCase() + ":" + param.requestDecodedDnsPacket.questions[0].type;
  let cacheRes = this.dnsResCache.Get(dn);
  let now = Date.now();
  //console.log("dn ::"+dn)
  // 30sec grace time for expired cache entries
  if (!cacheRes || (now >= (cacheRes.data.ttlEndTime + 30))) {
    //console.log("dn Not in local Cache")
    cacheRes = await checkSecondLevelCacheBfrResolve.call(
      this,
      param.runTimeEnv,
      param.request.url,
      dn,
    );
    if (!cacheRes) {
      cacheRes = {};
      resp.responseBodyBuffer = await resolveDnsUpdateCache.call(
        this,
        param,
        cacheRes,
        dn,
      );
      resp.responseDecodedDnsPacket = cacheRes.data.decodedDnsPacket
    } else {
      resp.responseDecodedDnsPacket = cacheRes.data.decodedDnsPacket
      resp.responseDecodedDnsPacket.id = param.requestDecodedDnsPacket.id
      resp.responseBodyBuffer = await loadDnsResponseFromCache.call(this, resp.responseDecodedDnsPacket, cacheRes.data.ttlEndTime);
    }
  } else {
    //console.log("dn found in local cache")
    resp.responseDecodedDnsPacket = cacheRes.data.decodedDnsPacket
    resp.responseDecodedDnsPacket.id = param.requestDecodedDnsPacket.id
    resp.responseBodyBuffer = await loadDnsResponseFromCache.call(this, resp.responseDecodedDnsPacket, cacheRes.data.ttlEndTime);
  }
  this.dnsResCache.Put(cacheRes);
  return resp;
}

async function loadDnsResponseFromCache(dnsPacket, ttlEndTime) {
  let now = Date.now();
  if (dnsPacket.decodedDnsPacket.answers.length > 0) {
    //set 30sec grace time when ttl from cache is negative
    dnsPacket.decodedDnsPacket.answers[0].ttl = Math.max(
      Math.floor((ttlEndTime - now) / 1000),
      30,
    );
  }
  return this.dnsParser.Encode(dnsPacket);
}

async function checkSecondLevelCacheBfrResolve(runTimeEnv, reqUrl, dn) {
  if (runTimeEnv == "worker") {
    //console.log("check in worker cache")
    let wCacheUrl = new URL((new URL(reqUrl)).origin + "/" + dn);
    //console.log(wCacheUrl)
    let resp = await this.wCache.match(wCacheUrl);
    if (resp) {
      //console.log("dn found in worker cache")
      let cacheRes = {}
      cacheRes.k = dn;
      cacheRes.data = {};
      cacheRes.data.decodedDnsPacket = this.dnsParser.Encode(await resp.arrayBuffer());
      let metaData = JSON.parse(resp.headers.get("x-rethink-metadata"))
      cacheRes.data.ttlEndTime = metaData.ttlEndTime
      cacheRes.data.addTime = metaData.addTime
      let now = Date.now();
      //console.log(workerCacheData)
      // 30sec grace time for expired cache entries
      if (now >= (cacheRes.data.ttlEndTime + 30)) {
        //console.log("worker cache expired by ttl")
        return false;
      }
      return cacheRes;
    }
    //console.log("dn not found in Worker cache")
  }
  return false;
}

/**
 * @param {Object} param
 * @param {Object} cacheRes
 * @param {String} dn
 * @returns
 */
async function resolveDnsUpdateCache(param, cacheRes, dn) {
  let responseBodyBuffer = await (await resolveDns(
    param.request,
    param.dnsResolverUrl,
    param.requestBodyBuffer,
    param.runTimeEnv,
  )).arrayBuffer();

  let decodedDnsPacket = await this.dnsParser.Decode(
    responseBodyBuffer,
  );
  // min 60sec ttl for single answers and 300sec for multi or no answer
  let ttl = decodedDnsPacket.answers.length == 1
    ? Math.max(decodedDnsPacket.answers[0].ttl, 60)
    : 300; // todo - check all answers to find min ttl

  cacheRes.k = dn;
  cacheRes.data = {};
  cacheRes.data.decodedDnsPacket = decodedDnsPacket;
  cacheRes.data.ttlEndTime = (ttl * 1000) + Date.now();
  cacheRes.data.addTime = Date.now()

  if (param.runTimeEnv == "worker") {
    let wCacheUrl = new URL((new URL(param.request.url)).origin + "/" + dn);
    let response = new Response(responseBodyBuffer, {
      cf: { cacheTtl: ttl },
    });
    let metaData = {}
    metaData.ttlEndTime = cacheRes.data.ttlEndTime
    metaData.addTime = cacheRes.data.addTime
    response.headers.set('x-rethink-metadata', JSON.stringify(metaData))
    this.wCache.put(wCacheUrl, response);
    //console.log("Added to worker Cache")
  }
  //console.log("Added to Local Cache")
  return responseBodyBuffer;
}

/**
 * @param {Request} request
 * @param {String} resolverUrl
 * @param {ArrayBuffer} requestBodyBuffer
 * @param {String} runTimeEnv
 * @returns
 */
async function resolveDns(request, resolverUrl, requestBodyBuffer, runTimeEnv) {
  try {
    let u = new URL(request.url);
    let dnsResolverUrl = new URL(resolverUrl);
    u.hostname = dnsResolverUrl.hostname; // override host, default cloudflare-dns.com
    u.pathname = dnsResolverUrl.pathname; // override path, default /dns-query
    u.port = dnsResolverUrl.port; // override port, default 443
    u.protocol = dnsResolverUrl.protocol; // override proto, default https

    const headers = {
      "Accept": "application/dns-message",
    };

    let newRequest;
    if (
      request.method === "GET" ||
      runTimeEnv == "worker" && request.method === "POST"
    ) {
      u.search = runTimeEnv == "worker" && request.method === "POST"
        ? "?dns=" +
        btoa(String.fromCharCode(...new Uint8Array(requestBodyBuffer)))
          .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
        : u.search;
      // console.debug("buf length:", requestBodyBuffer.byteLength);
      // console.debug(u.href);
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
