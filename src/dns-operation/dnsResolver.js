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
import { DNSParserWrap as DnsParser } from "../dns-operation/dnsOperation.js";

export default class DNSResolver {
  constructor() {
    this.http2 = null;
    this.nodeUtil = null;
    this.transport = null;
    this.dnsParser = new DnsParser();
    this.log = log.withTags("DnsResolver");
  }

  async lazyInit() {
    if (envutil.isNode() && !this.http2) {
      this.http2 = await import("http2");
      this.log.i("created custom http2 client");
    }
    if (envutil.isNode() && !this.nodeUtil) {
      this.nodeUtil = await import("../helpers/node/util.js");
      this.log.i("imported node-util");
    }
    if (envutil.isNode() && !this.transport) {
      const plainOldDnsIp = dnsutil.dnsIpv4();
      this.transport = new (
        await import("../helpers/node/dns-transport.js")
      ).Transport(plainOldDnsIp, 53);
      this.log.i("created udp/tcp dns transport", plainOldDnsIp);
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
      this.log.e(param.rxid, "main", e);
    }

    return response;
  }

  async resolveDns(param) {
    const rxid = param.rxid;
    const upRes = await this.resolveDnsUpstream(
      rxid,
      param.request,
      param.dnsResolverUrl,
      param.requestBodyBuffer
    );

    return await this.decodeResponse(rxid, upRes);
  }

  async decodeResponse(rxid, response) {
    if (!response) throw new Error("no upstream result");

    if (!response.ok) {
      const txt = await response.text();
      this.log.d(rxid, "!OK", response.status, response.statusText, txt);
      throw new Error(response.status + " http err: " + response.statusText);
    }

    const dnsBuffer = await response.arrayBuffer();

    if (!dnsutil.validResponseSize(dnsBuffer)) {
      throw new Error("Null / invalid response from upstream");
    }

    // TODO: at times, dnsutil.encode sets answer[0].ttl to some large number
    const dnsPacket = this.dnsParser.decode(dnsBuffer);

    return {
      dnsPacket: dnsPacket,
      dnsBuffer: dnsBuffer,
    };
  }
}

/**
 * @param {Request} request
 * @param {String} resolverUrl
 * @param {ArrayBuffer} requestBodyBuffer
 * @returns
 */
DNSResolver.prototype.resolveDnsUpstream = async function (
  rxid,
  request,
  resolverUrl,
  requestBodyBuffer
) {
  // for now, upstream plain-old dns on fly
  if (this.transport) {
    const q = util.bufferOf(requestBodyBuffer);

    let ans = await this.transport.udpquery(rxid, q);
    if (ans && dnsutil.truncated(ans)) {
      this.log.w(rxid, "ans truncated, retrying over tcp");
      ans = await this.transport.tcpquery(rxid, q);
    }

    return ans ? new Response(util.arrayBufferOf(ans)) : util.respond503();
  }

  const u = new URL(request.url);
  const dnsResolverUrl = new URL(resolverUrl);
  u.hostname = dnsResolverUrl.hostname; // default cloudflare-dns.com
  u.pathname = dnsResolverUrl.pathname; // override path, default /dns-query
  u.port = dnsResolverUrl.port; // override port, default 443
  u.protocol = dnsResolverUrl.protocol; // override proto, default https

  let newRequest = null;
  // even for GET requests, plugin.js:getBodyBuffer converts contents of
  // u.search into an arraybuffer that then needs to be reconverted back
  if (request.method === "GET") {
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

  return this.http2 ? this.doh2(rxid, newRequest) : fetch(newRequest);
};

/**
 * Resolve DNS request using HTTP/2 API of Node.js
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
