/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

export default class DNSResolver {
  constructor() {
    try {
      this.dnsResolverUrl = CF_DNS_RESOLVER_URL;
    } catch (e) {
      if (e instanceof ReferenceError) {
        ({
          CF_DNS_RESOLVER_URL: this.dnsResolverUrl,
        } = Deno.env.toObject());
      } else throw e;
    }
  }
  /**
   * @param {*} param
   * @param {*} param.request
   * @param {*} param.requestBodyBuffer
   * @param {*} param.dnsResolverUrl
   * @returns
   */
  async RethinkModule(param) {
    let response = {};
    response.isException = false;
    response.exceptionStack = "";
    response.exceptionFrom = "";
    response.data = {};
    try {
      if (!param.dnsResolverUrl) {
        param.dnsResolverUrl = this.dnsResolverUrl;
      }
      response.data.responseBodyBuffer = await (await resolveDns(
        param.request,
        param.dnsResolverUrl,
        param.requestBodyBuffer,
      )).arrayBuffer();
    } catch (e) {
      response.isException = true;
      response.exceptionStack = e.stack;
      response.exceptionFrom = "DNSResolver RethinkModule";
      response.data = false;
      console.log("Error At : DNSResolver -> RethinkModule");
      console.log(e.stack);
    }
    return response;
  }
}

async function resolveDns(request, resolverUrl, requestBodyBuffer) {
  try {
    let u = new URL(request.url);
    let dnsResolverUrl = new URL(resolverUrl);
    u.hostname = dnsResolverUrl.hostname; // override host, default cloudflare-dns.com
    u.pathname = dnsResolverUrl.pathname; // override path, default /dns-query
    u.port = dnsResolverUrl.port; // override port, default 443
    u.protocol = dnsResolverUrl.protocol; // override proto, default https

    let newRequest;
    if (request.method === "GET") {
      newRequest = new Request(u.href, {
        method: "GET",
        headers: { // FIXME: are these headers needed?
          "crossDomain": "true",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers":
            "X-Requested-With, Content-Type, Authorization, Origin, Accept, Access-Control-Request-Method, Access-Control-Request-Headers",
          "Access-Control-Allow-Methods": "POST, GET, PUT, OPTIONS, DELETE",
          "Content-Type": "application/dns-message",
          "accept": "application/dns-message",
        },
      });
    } else if (request.method === "POST") {
      newRequest = new Request(u.href, {
        method: "POST",
        headers: { // FIXME: are these headers needed?
          "crossDomain": "true",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers":
            "X-Requested-With, Content-Type, Authorization, Origin, Accept, Access-Control-Request-Method, Access-Control-Request-Headers",
          "Access-Control-Allow-Methods": "POST, GET, PUT, OPTIONS, DELETE",
          "Content-Type": "application/dns-message",
          "accept": "application/dns-message",
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
