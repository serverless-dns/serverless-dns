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

((main) => {
  if (typeof addEventListener === "undefined") {
    throw new Error("workers env missing addEventListener");
  }

  addEventListener("fetch", handleFetch);
})();

function handleFetch(event) {
  // FetchEvent handler has to call respondWith() before returning.
  // Any asynchronous task will be canceled and by default, the
  // request will be sent unmodified to origin (which doesn't exist
  // and so these are 4xx responses, in our case). To wait for IO
  // before generating a Response, calling respondWith() with a
  // Promise (for the eventual Response) as the argument.
  event.respondWith(serveDoh(event));
}

function serveDoh(event) {
  // on Workers, the network-context is only available in an event listener
  // and so, publish system prepare from here instead of from main which
  // runs in global-scope.
  system.pub("prepare");

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
