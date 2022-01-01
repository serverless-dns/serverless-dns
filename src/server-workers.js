/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import "./helpers/workers/config.js";
import { handleRequest } from "./index.js";
import * as system from "./system.js";
import * as util from "./helpers/util.js";

let up = false;

((main) => {
  if (typeof addEventListener === "undefined") {
    throw new Error("workers env missing addEventListener");
  }

  system.sub("go", systemUp);

  addEventListener("fetch", serveDoh);
})();

function systemUp() {
  up = true;
}

function serveDoh(event) {
  if (!up) {
    event.respondWith(util.respond503());
    return;
  }

  event.respondWith(handleRequest(event));
}
