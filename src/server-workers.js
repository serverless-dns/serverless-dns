/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import "./helpers/workers/config.js";
import * as system from "./system.js";
import { handleRequest } from "./index.js";

((main) => {
  system.sub("go", systemUp);
})();

function systemUp() {
  if (typeof addEventListener === "undefined") {
    throw new Error("workers env missing addEventListener");
  }
  addEventListener("fetch", (event) => {
    event.respondWith(handleRequest(event));
  });
}
