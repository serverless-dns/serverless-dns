/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { Buffer } from "buffer";
import * as dnsutil from "../helpers/dnsutil.js";
import * as util from "../helpers/util.js";
import * as envutil from "../helpers/envutil.js";
import { DNSParserWrap as Dns } from "../dns-operation/dnsOperation.js";

const quad1 = "1.1.1.2";
export default class DNSResolver {
  constructor() {
    this.http2 = null;
    this.nodeUtil = null;
    this.transport = null;
    this.dnsParser = new Dns();    
  }

  async lazyInit() {
    if (envutil.isNode() && !this.http2) {
      this.http2 = await import("http2");
      this.nodeUtil = await import("../helpers/node/util.js");
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
   * @param {DnsDecodeObject} param.requestDecodedDnsPacket
   * @param {Worker-Event} param.event
   * @param {} param.blocklistFilter
   * @param {DnsCache} param.dnsCache
   * @returns
   */
  async RethinkModule(param) {
    await this.lazyInit();
    let response = util.emptyResponse();
    try {
      response.data = await this.resolveDns(param);
    } catch (e) {
      response = util.errResponse("dnsResolver", e);
      log.e("Err DNSResolver -> RethinkModule", e);
    }
    return response;
  }

  async resolveDns(param) {
    let resp = {};
    const key =
      (param.requestDecodedDnsPacket.questions.length > 0
        ? param.requestDecodedDnsPacket.questions[0].name
        : "")
        .trim()
        .toLowerCase() +
      ":" +
      param.requestDecodedDnsPacket.questions[0].type;
    let cacheResponse = await param.dnsCache.get(key, param.request.url);
    const now = Date.now();
    if (cacheResponse) {
      console.debug("Response Found in cache", JSON.stringify(cacheResponse));
      resp.responseDecodedDnsPacket = cacheResponse.decodedDnsPacket;
      resp.responseDecodedDnsPacket.id = param.requestDecodedDnsPacket.id;
      this.updateTtl(cacheResponse.decodedDnsPacket, cacheResponse.metaData.ttlEndTime);
      resp.responseBodyBuffer = this.dnsParser.encode(cacheResponse.decodedDnsPacket);
      return resp;
    }

    const upRes = await this.resolveDnsUpstream(
      param.request,
      param.dnsResolverUrl,
      param.requestBodyBuffer,
    );

    resp = await decodeResponse(upRes, this.dnsParser);

    // TODO: only cache noerror / nxdomain responses
    // TODO: nxdomain ttls are in the authority section
    let minttl = 0;
    for (let answer of resp.responseDecodedDnsPacket.answers) {
      minttl = minttl <= 0 || minttl > answer.ttl ? answer.ttl : minttl;
    }

    const ttlEndTime = minttl * 1000 + now;

    let cacheInput = {};
    cacheInput.metaData = cacheMetadata(
      resp.responseDecodedDnsPacket,
      ttlEndTime,
      param.blocklistFilter,
    );
    cacheInput.decodedDnsPacket = resp.responseDecodedDnsPacket;
    param.event.waitUntil(param.dnsCache.put(key, cacheInput, param.request.url, resp.responseBodyBuffer));
    return resp
  }

  updateTtl(decodedDnsPacket, end) {
    const now = Date.now();
    const outttl = Math.max(Math.floor((end - now) / 1000), 30); // ttl grace already set during cache put
    for (let a of decodedDnsPacket.answers) {
      if (!dnsutil.optAnswer(a)) a.ttl = outttl;
    }
  }

}

function cacheMetadata(dnsPacket, ttlEndTime, blocklistFilter) {
  const question = dnsPacket.questions.length > 0
    ? dnsPacket.questions[0].name
    : "";
  return {
    ttlEndTime: ttlEndTime,
    bodyUsed: true,
    // TODO: Why not store blocklist-info in LocalCache?
    blocklistInfo: util.objOf(blocklistFilter.getDomainInfo(question).searchResult),
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
  requestBodyBuffer,
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
        headers: util.concatHeaders(
          util.contentLengthHeader(requestBodyBuffer),
          util.dnsHeaders()
        ),
        body: requestBodyBuffer,
      });
    } else {
      throw new Error("get/post requests only");
    }

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
  const transformPseudoHeaders = this.nodeUtil.transformPseudoHeaders;

  const u = new URL(request.url);
  const reqB = util.bufferOf(await request.arrayBuffer());
  const headers = util.copyHeaders(request);

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
      const resH = transformPseudoHeaders(headers);
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

async function decodeResponse(response, dnsParser) {
  if (!response) throw new Error("no upstream result");

  if (!response.ok) {
    log.d("!OK", response.status, response.statusText, await response.text());
    throw new Error(response.status + " http err: " + response.statusText);
  }
  let retResponse = {};
  retResponse.responseBodyBuffer = await response.arrayBuffer();

  if (!dnsutil.validResponseSize(retResponse.responseBodyBuffer)) {
    throw new Error("Null / invalid response from upstream");
  }
  try {
    //Todo: call dnsutil.encode makes answer[0].ttl as some big number need to debug.
    retResponse.responseDecodedDnsPacket = dnsParser.decode(
      retResponse.responseBodyBuffer,
    );
  } catch (e) {
    log.e("decode fail " + response.status + " cache? " + responseBodyBuffer);
    throw e;
  }
  return retResponse;
}
