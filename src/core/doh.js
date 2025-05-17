/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as dnsutil from "../commons/dnsutil.js";
import * as util from "../commons/util.js";
import * as pres from "../plugins/plugin-response.js";
import IOState from "./io-state.js";
import RethinkPlugin from "./plugin.js";

// TODO: define FetchEventLike
/**
 * @typedef {any} FetchEventLike
 */

/**
 * @param {FetchEvent|FetchEventLike} event
 * @returns {Promise<Response>}
 */
export function handleRequest(event) {
  return proxyRequest(event);
}

/**
 * @param {FetchEvent} event
 * @returns {Promise<Response>}
 */
async function proxyRequest(event) {
  if (optionsRequest(event.request)) return util.respond204();

  const io = new IOState();
  const ua = event.request.headers.get("User-Agent");

  try {
    const plugin = new RethinkPlugin(event);
    await plugin.initIoState(io);

    // if an early response has been set by plugin.initIoState, return it
    if (io.httpResponse) {
      return withCors(io, ua);
    }

    await util.timedSafeAsyncOp(
      /* op*/ () => plugin.execute(),
      /* waitMs*/ dnsutil.requestTimeout(),
      /* onTimeout*/ () => Promise.resolve(errorResponse(io))
    );
  } catch (err) {
    log.e("doh", "proxy-request error", err.stack);
    errorResponse(io, err);
  }

  return withCors(io, ua);
}

function optionsRequest(request) {
  return request.method === "OPTIONS";
}

/**
 * @param {IOState} io
 * @param {Error} err
 */
function errorResponse(io, err = null) {
  const eres = pres.errResponse("doh.js", err);
  io.dnsExceptionResponse(eres);
}

/**
 * @param {IOState} io
 * @param {string} ua
 * @returns {Response}
 */
function withCors(io, ua) {
  if (util.fromBrowser(ua)) io.setCorsHeadersIfNeeded();
  return io.httpResponse;
}
