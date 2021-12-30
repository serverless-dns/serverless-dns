/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import CurrentRequest from "./helpers/currentRequest.js";
import RethinkPlugin from "./helpers/plugin.js";
import EnvManager from "./helpers/env.js";
import Log from "./helpers/log.js";
import * as util from "./helpers/util.js";
import * as dnsutil from "./helpers/dnsutil.js";
import * as system from "./system.js";

export function handleRequest(event) {

  return Promise.race([
    new Promise((accept, _) => {
      accept(proxyRequest(event));
    }),

    new Promise((accept, _) => {
      // on timeout, servfail
      util.timeout(dnsutil.requestTimeout(), () =>
        accept(servfail(event.request))
      );
    }),
  ]);

}

async function proxyRequest(event) {
  try {
    if (optionsRequest(event.request)) return respond204();

    const currentRequest = new CurrentRequest();
    const plugin = new RethinkPlugin(event);
    await plugin.executePlugin(currentRequest);

    const ua = event.request.headers.get("User-Agent");
    if (util.fromBrowser(ua)) currentRequest.setCorsHeaders();

    return currentRequest.httpResponse;
  } catch (err) {
    log.e(err.stack);
    return errorOrServfail(event.request, err);
  }
}

function optionsRequest(request) {
  return request.method === "OPTIONS";
}

function respond204() {
  return new Response(null, {
    status: 204, // no content
    headers: util.corsHeaders(),
  });
}

function errorOrServfail(request, err) {
  const UA = request.headers.get("User-Agent");
  if (!util.fromBrowser(UA)) return servfail();

  const res = new Response(JSON.stringify(err.stack), {
    status: 503, // unavailable
    headers: util.browserHeaders(),
  });
  return res;
}

function servfail() {
  return new Response(
    dnsutil.servfail(), // null response
    {
      status: 503, // unavailable
      headers: util.dnsHeaders(),
    }
  );
}
