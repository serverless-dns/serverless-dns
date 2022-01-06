/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import CurrentRequest from "./helpers/currentRequest.js";
import RethinkPlugin from "./helpers/plugin.js";
import * as util from "./helpers/util.js";
import * as dnsutil from "./helpers/dnsutil.js";

export function handleRequest(event) {
  return Promise.race([
    new Promise((accept, _) => {
      accept(proxyRequest(event));
    }),

    new Promise((accept, _) => {
      // on timeout, servfail
      util.timeout(dnsutil.requestTimeout(), () => accept(servfail()));
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
    log.e(err.stack);
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
