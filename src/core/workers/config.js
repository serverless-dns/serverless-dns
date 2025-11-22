/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as system from "../../system.js";
import EnvManager from "../env.js";
import Log, { hasLogger, log, setLogger } from "../log.js";
import { services } from "../svc.js";

((_main) => {
  system.when("prepare").then(prep);
  system.when("steady").then(up);
})();

// on Workers, setup is called for every new request,
// since server-workers.js fires "prepare" on every request
function prep(arg) {
  // if this file execs... assume we're on workers.
  if (!arg) throw new Error("are we on workers?");
  if (!arg.env) throw new Error("workers cannot be setup with empty env");

  const wenv = arg.env;
  // okay to attach env to global, as env across requests remains the same
  // developers.cloudflare.com/workers/runtime-apis/fetch-event/#parameters
  globalThis.wenv = wenv;

  if (!globalThis.envManager) {
    globalThis.envManager = new EnvManager();
  }

  const isProd = wenv.WORKER_ENV === "production";
  const lvl = wenv.LOG_LEVEL;

  if (!hasLogger()) {
    setLogger(
      new Log({
        level: lvl || "info",
        levelize: isProd,
      })
    );
  }

  // on Workers, the network-context isn't available in global-scope
  // ie network requests, for ex over fetch-api or xhr, don't work.
  // And so, system ready event is published by the event listener
  // which has the network-context, that is necessary for svc.js
  // to setup blocklist-filter, which otherwise fails when invoked
  // from global-scope (such as the "main" function in this file).
  system.pub("ready", { env: arg.env });
}

function up() {
  if (!services.ready) {
    log.e("services not yet ready, and we've got a sig-up?!");
    return;
  }
  // nothing else to do on sig-up on Workers; fire a sig-go!
  system.pub("go");
}
