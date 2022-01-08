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

const upTimeoutMs = 1500; // 1.5s

((main) => {
  if (typeof addEventListener === "undefined") {
    throw new Error("workers env missing addEventListener");
  }

  addEventListener("fetch", serveDoh);
})();

function serveDoh(event) {
  system
    .when("go", upTimeoutMs)
    .then((v) => {
      event.respondWith(handleRequest(event));
    })
    .catch((e) => {
      console.error(e);
      event.respondWith(util.respond405());
    });
}
