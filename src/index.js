/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import CurrentRequest from "./currentRequest.js";
import RethinkPlugin from "./plugin.js";
import Env from "./env.js";
import * as log from "./helpers/log.js";
import * as util from "./helpers/util.js";
import * as dnsutil from "./helpers/dnsutil.js";

const env = new Env();

if (typeof addEventListener !== "undefined") {
  addEventListener("fetch", (event) => {
    if (!env.isLoaded) {
      env.loadEnv();
    }
    event.respondWith(handleRequest(event));
  });
}

export function handleRequest(event) {
  const processingTimeout = env.get("workerTimeout");
  const respectTimeout = (env.get("runTimeEnv") == "worker" && processingTimeout > 0)

  if (!respectTimeout) return proxyRequest(event);

  return Promise.race([
    new Promise((resolve, _) => {
      resolve(proxyRequest(event));
    }),
    new Promise((resolve, _) => {
      setTimeout(() => { // on timeout, send a serv-fail
        resolve(servfail(event));
      }, processingTimeout);
    }),
  ]);

}

async function proxyRequest(event) {
  try {
    if (event.request.method === "OPTIONS") {
      const res = new Response(null, { status: 204 });
      util.corsHeaders(res);
      return res;
    }

    // For environments which don't use FetchEvent to handle request.
    if (!env.isLoaded) {
      env.loadEnv();
    }
    const currentRequest = new CurrentRequest();
    const plugin = new RethinkPlugin(event, env);
    await plugin.executePlugin(currentRequest);

    util.dohHeaders(event.request, currentRequest.httpResponse);

    return currentRequest.httpResponse;

  } catch (err) {
    log.e(err.stack);
    return errorOrServfail(event, err);
  }
}

function errorOrServfail(event, err) {
  if (util.fromBrowser(event)) {
    const res = new Response(JSON.stringify(e.stack));
    util.browserHeaders(res);
    return res;
  }
  return servfail(event);
}

function servfail(event) {
  const res = new Response(dnsutil.servfail);
  util.dohHeaders(event.request, res);
  return res;
}

