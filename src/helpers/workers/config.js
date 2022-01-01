/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import EnvManager from "../env.js";
import * as system from "../../system.js";
import Log from "../log.js";

((main) => {
  // if we're executing this file, we're on workers
  globalThis.RUNTIME = "worker";

  const isProd = globalThis.WORKER_ENV === "production";

  if (!globalThis.envManager) {
    globalThis.envManager = new EnvManager();
  }

  globalThis.log = new Log(
    env.logLevel,
    isProd // set console level only in prod.
  );

  system.pub("ready");
})();
