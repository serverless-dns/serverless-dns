/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import CurrentRequest from "./currentRequest.js";
import RethinkPlugin from "./plugin.js";
import * as util from "../commons/util.js";
import * as dnsutil from "../commons/dnsutil.js";

export function handleRequest(event) {
  return Promise.race([
    new Promise((accept, _) => {
      accept(proxyRequest(event));
    }),

    // TODO: cancel timeout once proxyRequest is complete
    // util.timedOp is one way to do so, but it results in a reject
    // on timeouts which manifests as "exception" to upstream (server-
    // -worker/deno/node) that then needs to handle it as approp.
    new Promise((accept, _) => {
      // on timeout, servfail
      util.timeout(dnsutil.requestTimeout(), () => {
        log.e("doh", "handle-request timeout");
        accept(servfail());
      });
    }),
  ]);
}

async function proxyRequest(event) {
  try {
    if (optionsRequest(event.request)) return util.respond204();

    const currentRequest = new CurrentRequest();
    const plugin = new RethinkPlugin(event);
    await plugin.executePlugin(currentRequest);

    const ua = event.request.headers.get("User-Agent");
    if (util.fromBrowser(ua)) currentRequest.setCorsHeadersIfNeeded();

    return currentRequest.httpResponse;
  } catch (err) {
    log.e("doh", "proxy-request error", err);
    return errorOrServfail(event.request, err);
  }
}

function optionsRequest(request) {
  return request.method === "OPTIONS";
}

function errorOrServfail(request, err) {
  const ua = request.headers.get("User-Agent");
  if (!util.fromBrowser(ua)) return servfail();

  const res = new Response(JSON.stringify(err.stack), {
    status: 503, // unavailable
    headers: util.browserHeaders(),
  });
  return res;
}

function servfail() {
  return util.respond503();
}
