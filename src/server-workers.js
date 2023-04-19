/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import "./core/workers/config.js";
import { handleRequest } from "./core/doh.js";
import * as system from "./system.js";
import * as util from "./commons/util.js";

export default {
  // workers/runtime-apis/fetch-event#syntax-module-worker
  async fetch(request, env, context) {
    return await serveDoh(request, env, context);
  },
};

function serveDoh(request, env, ctx) {
  // on Workers, the network-context is only available in an event listener
  // and so, publish system prepare from here instead of from main which
  // runs in global-scope.
  system.pub("prepare", { env: env });

  const event = util.mkFetchEvent(
    request,
    null,
    ctx.waitUntil.bind(ctx),
    ctx.passThroughOnException.bind(ctx)
  );

  return new Promise((accept) => {
    system
      .when("go")
      .then((v) => {
        return handleRequest(event);
      })
      .then((response) => {
        accept(response);
      })
      .catch((e) => {
        console.error("server", "serveDoh err", e);
        accept(util.respond405());
      });
  });
}
