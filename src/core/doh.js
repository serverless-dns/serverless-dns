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
  return proxyRequest(event);
}

async function proxyRequest(event) {
  if (optionsRequest(event.request)) return util.respond204();

  const cr = new CurrentRequest();

  try {
    const plugin = new RethinkPlugin(event);

    await util.timedSafeAsyncOp(
      /* op*/ async () => plugin.executePlugin(cr),
      /* waitMs*/ dnsutil.requestTimeout(),
      /* onTimeout*/ async () => errorResponse(cr)
    );
  } catch (err) {
    log.e("doh", "proxy-request error", err);
    errorResponse(cr, err);
  }

  // TODO: cors-headers are also set in server-node.js
  // centralize setting these in just one place, if possible
  const ua = event.request.headers.get("User-Agent");
  if (util.fromBrowser(ua)) cr.setCorsHeadersIfNeeded();

  return cr.httpResponse;
}

function optionsRequest(request) {
  return request.method === "OPTIONS";
}

function errorResponse(currentRequest, err = null) {
  const eres = util.emptyObj(err) ? null : util.errResponse("doh.js", err);
  currentRequest.dnsExceptionResponse(eres);
}
