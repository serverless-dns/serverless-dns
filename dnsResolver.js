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
    this.dnsResCache = false
  }
  /**
   * @param {*} param
   * @param {Request} param.request
   * @param {ArrayBuffer} param.requestBodyBuffer
   * @param {String} param.dnsResolverUrl
   * @param {String} param.runTimeEnv
   * @param {WorkerEvent} event
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
          500,
          2,
          param.runTimeEnv,
        );
      }
      response.data.responseBodyBuffer = await checkCacheBfrResolve.call(this, param)
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
async function checkCacheBfrResolve(param) {
  let responseBodyBuffer
  let decodedDnsPacket = await this.dnsParser.Decode(
    param.requestBodyBuffer
  );

  const dn = (decodedDnsPacket.questions.length > 0 ? decodedDnsPacket.questions[0].name : "").trim().toLowerCase() + ":" + decodedDnsPacket.questions[0].type
  let cacheRes = this.dnsResCache.Get(dn)
  if (!cacheRes) {
    //console.log("Not in Cache -> resolve and update")
    cacheRes = {}
    responseBodyBuffer = await resolveDnsUpdateCache.call(this, param, cacheRes, dn)
  }
  else {
    let now = Date.now()
    // 30sec grace time for expired cache entries
    if (now <= (cacheRes.data.ttlEndTime + 30)) {
      //console.log("Found in Cache with ttl - used from cache")
      //console.log(now + "::" + cacheRes.data.ttlEndTime + "::diff::" + cacheRes.data.ttlEndTime - now)
      decodedDnsPacket = cacheRes.data.decodedDnsPacket
      if (decodedDnsPacket.answers.length > 0) {
        //set 30sec grace time when ttl from cache is negative
        decodedDnsPacket.answers[0].ttl = Math.max(Math.floor((cacheRes.data.ttlEndTime - now) / 1000), 30)
      }
      responseBodyBuffer = this.dnsParser.Encode(decodedDnsPacket)
    }
    else {
      //console.log("Found in Cache with expired ttl -> resolve and update")
      responseBodyBuffer = await resolveDnsUpdateCache.call(this, param, cacheRes, dn)
    }
  }
  this.dnsResCache.Put(cacheRes, param.event, param.runTimeEnv);
  return responseBodyBuffer
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
    responseBodyBuffer
  );
  // min 60sec ttl for single answers and 300sec for multi or no answer
  let ttl = decodedDnsPacket.answers.length == 1 ? Math.max(decodedDnsPacket.answers[0].ttl, 60) : 300 // todo - check all answers to find min ttl

  cacheRes.k = dn
  cacheRes.data = {}
  cacheRes.data.decodedDnsPacket = decodedDnsPacket
  cacheRes.data.ttlEndTime = (ttl * 1000) + Date.now()
  //console.log(JSON.stringify(cacheRes))
  return responseBodyBuffer
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

    const headers = { // FIXME: are these headers needed? ~ mz
      "Content-Type": "application/dns-message"
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
          "content-length": requestBodyBuffer.byteLength,
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
