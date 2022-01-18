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
  return util.timedSafeAsyncOp(
    async () => proxyRequest(event),
    dnsutil.requestTimeout(),
    servfail()
  );
}

async function proxyRequest(event) {
  if (optionsRequest(event.request)) return util.respond204();

  const cr = new CurrentRequest();

  try {
    const plugin = new RethinkPlugin(event);
    await plugin.executePlugin(cr);

    // TODO: cors-headers are also set in server-node.js
    // centralize setting these in just one place, if possible
    const ua = event.request.headers.get("User-Agent");
    if (util.fromBrowser(ua)) currentRequest.setCorsHeadersIfNeeded();

    return cr.httpResponse;
  } catch (err) {
    log.e("doh", "proxy-request error", err);
    return errorOrServfail(event.request, err, cr);
  }
}

function optionsRequest(request) {
  return request.method === "OPTIONS";
}

function errorOrServfail(request, err, currentRequest) {
  const ua = request.headers.get("User-Agent");
  if (!util.fromBrowser(ua)) return servfail(currentRequest);

  const res = new Response(JSON.stringify(err.stack), {
    status: 503, // unavailable
    headers: util.browserHeaders(),
  });
  return res;
}

function servfail(currentRequest) {
  if (
    util.emptyObj(currentRequest) ||
    util.emptyObj(currentRequest.decodedDnsPacket)
  ) {
    return util.respond408();
  }

  const qid = currentRequest.decodedDnsPacket.id;
  const qs = currentRequest.decodedDnsPacket.questions;
  return dnsutil.servfail(qid, qs);
}
