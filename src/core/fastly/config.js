/*
 * Copyright (c) 2022 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import { allowDynamicBackends } from "fastly:experimental";
import * as system from "../../system.js";
import EnvManager from "../env.js";
import Log, { hasLogger, log, setLogger } from "../log.js";
import { services } from "../svc.js";

system.when("prepare").then(prep);
system.when("steady").then(up);

// on Fastly, setup is called for every new request,
// since server-fastly.js fires "prepare" on every request
function prep() {
  allowDynamicBackends(true);

  // This is used within `EnvManager`
  if (!globalThis.fastlyEnv) {
    globalThis.fastlyEnv = new Dictionary("env");
  }

  if (!globalThis.envManager) {
    globalThis.envManager = new EnvManager();
  }

  const isProd = envManager.get("env") === "production";

  if (!hasLogger()) {
    setLogger(
      new Log({
        level: envManager.get("LOG_LEVEL"),
        levelize: isProd, // levelize only in prod
        withTimestamps: false, // no need to log ts on fastly
      })
    );
  }

  // on Fastly, the network-context isn't available in global-scope
  // ie network requests, for ex over fetch-api or xhr, don't work.
  // And so, system ready event is published by the event listener
  // which has the network-context, that is necessary for svc.js
  // to setup blocklist-filter, which otherwise fails when invoked
  // from global-scope (such as the "main" function in this file).
  system.pub("ready");
}

function up() {
  if (!services.ready) {
    log.e("services not yet ready, and we've got a sig-up?!");
    return;
  }
  // nothing else to do on sig-up on Fastly; fire a sig-go!
  system.pub("go");
}
