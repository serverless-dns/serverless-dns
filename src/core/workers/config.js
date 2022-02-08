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
  system.when("prepare").then(setup);
})();

// on Workers, setup is called for every new request,
// since server-workers.js fires "prepare" on every request
function setup(arg) {
  // if this file execs... assume we're on workers.
  if (!arg) throw new Error("are we on workers?");
  if (!arg.env) throw new Error("workers cannot be setup with empty env");

  globalThis.wenv = arg.env;

  if (!globalThis.envManager) {
    globalThis.envManager = new EnvManager();
  }

  const isProd = wenv.WORKER_ENV === "production";

  if (!globalThis.log) {
    globalThis.log = new Log({
      level: envManager.get("LOG_LEVEL"),
      levelize: isProd, // levelize only in prod
      withTimestamps: false, // no need to log ts on workers
    });
  }

  // on Workers, the network-context isn't available in global-scope
  // ie network requests, for ex over fetch-api or xhr, don't work.
  // And so, system ready event is published by the event listener
  // which has the network-context, that is necessary for svc.js
  // to setup blocklist-filter, which otherwise fails when invoked
  // from global-scope (such as the "main" function in this file).
  system.pub("ready");
}
