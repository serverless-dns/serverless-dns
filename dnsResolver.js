/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

export default class DNSResolver {
  constructor() {
  }
  /**
   * @param {*} param
   * @param {Request} param.request
   * @param {ArrayBuffer} param.requestBodyBuffer
   * @param {String} param.dnsResolverUrl
   * @param {String} param.runTimeEnv
   * @returns
   */
  async RethinkModule(param) {
    let response = {};
    response.isException = false;
    response.exceptionStack = "";
    response.exceptionFrom = "";
    response.data = {};
    try {
      response.data.responseBodyBuffer = await (await resolveDns(
        param.request,
        param.dnsResolverUrl,
        param.requestBodyBuffer,
        param.runTimeEnv,
      )).arrayBuffer();
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
      "crossDomain": "true",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "X-Requested-With, Content-Type, Authorization, Origin, Accept, Access-Control-Request-Method, Access-Control-Request-Headers",
      "Access-Control-Allow-Methods": "POST, GET, PUT, OPTIONS, DELETE",
      "Content-Type": "application/dns-message",
      "accept": "application/dns-message",
    };

    let newRequest;
    if (
      request.method === "GET" ||
      runTimeEnv == "worker" && request.method === "POST"
    ) {
      u.search = runTimeEnv == "worker" && request.method === "POST"
        ? "?dns=" +
          btoa(String.fromCharCode(...new Uint8Array(requestBodyBuffer)))
            .replace("+", "-").replace("/", "_").replace("=", "")
        : u.search;
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
