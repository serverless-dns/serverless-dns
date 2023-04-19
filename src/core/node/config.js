/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/**
 * Configuration file for node runtime
 * TODO: Remove all side-effects and use a constructor?
 * This module has side effects, sequentially setting up the environment.
 */
import { atob, btoa } from "buffer";
import process from "node:process";
import * as util from "./util.js";
import * as blocklists from "./blocklists.js";
import * as dbip from "./dbip.js";
import Log from "../log.js";
import * as system from "../../system.js";
import { services, stopAfter } from "../svc.js";
import EnvManager from "../env.js";
import * as swap from "../linux/swap.js";

(async (main) => {
  system.when("prepare").then(prep);
  system.when("steady").then(up);
})();

async function prep() {
  // if this file execs... assume we're on nodejs.
  const isProd = process.env.NODE_ENV === "production";
  const onFly = process.env.CLOUD_PLATFORM === "fly";
  const profiling = process.env.PROFILE_DNS_RESOLVES === "true";
  const debugFly = onFly && process.env.FLY_APP_NAME.includes("-dev");

  globalThis.envManager = new EnvManager();

  /** Logger */
  globalThis.log = debugFly
    ? new Log({
        level: "debug",
        levelize: profiling, // levelize only if profiling
        withTimestamps: true, // always log timestamps on node
      })
    : new Log({
        level: envManager.get("LOG_LEVEL"),
        levelize: isProd || profiling, // levelize if prod or profiling
        withTimestamps: true, // always log timestamps on node
      });

  // ---- log and envManager available only after this line ---- \\

  /** TLS crt and key */
  // If TLS_OFFLOAD == true, skip loading TLS certs and keys; otherwise:
  // Raw TLS CERT and KEY are stored (base64) in an env var for fly deploys
  // (fly deploys are dev/prod nodejs deploys where env TLS_CN or TLS_ is set).
  // Otherwise, retrieve KEY and CERT from the filesystem (this is the case
  // for local non-prod nodejs deploys with self-signed certs).
  // If requisite TLS secrets are missing, set tlsoffload to true, eventually.
  let tlsoffload = envManager.get("TLS_OFFLOAD");
  const _TLS_CRT_AND_KEY =
    eval(`process.env.TLS_${process.env.TLS_CN}`) || process.env.TLS_;
  const TLS_CERTKEY = process.env.TLS_CERTKEY;

  if (tlsoffload) {
    log.i("TLS offload enabled");
  } else if (isProd) {
    if (TLS_CERTKEY) {
      const [tlsKey, tlsCrt] = util.getCertKeyFromEnv(TLS_CERTKEY);
      envManager.set("TLS_KEY", tlsKey);
      envManager.set("TLS_CRT", tlsCrt);
      log.i("env (fly) tls setup with tls_certkey");
    } else if (_TLS_CRT_AND_KEY) {
      const [tlsKey, tlsCrt] = util.getCertKeyFromEnv(_TLS_CRT_AND_KEY);
      envManager.set("TLS_KEY", tlsKey);
      envManager.set("TLS_CRT", tlsCrt);
      log.i("[deprecated] env (fly) tls setup with tls_cn");
    } else {
      log.w("Skip TLS: neither TLS_CERTKEY nor TLS_CN set; enable TLS offload");
      tlsoffload = true;
    }
  } else {
    try {
      const devutils = await import("./util-dev.js");
      const [tlsKey, tlsCrt] = devutils.getTLSfromFile(
        envManager.get("TLS_KEY_PATH"),
        envManager.get("TLS_CRT_PATH")
      );
      envManager.set("TLS_KEY", tlsKey);
      envManager.set("TLS_CRT", tlsCrt);
      log.i("dev (local) tls setup from tls_key_path");
    } catch (ex) {
      // this can happen when running server in BLOCKLIST_DOWNLOAD_ONLY mode
      log.w("Skipping TLS: test TLS crt/key missing; enable TLS offload");
      tlsoffload = true;
    }
  }

  envManager.set("TLS_OFFLOAD", tlsoffload);

  if (!globalThis.atob || !globalThis.btoa) {
    globalThis.atob = atob;
    globalThis.btoa = btoa;
    log.i("polyfill atob / btoa");
  } else {
    log.i("no atob/btoa polyfill required");
  }

  /** Swap on Fly */
  if (onFly) {
    const ok = swap.mkswap();
    log.i("mkswap done?", ok);
  } else {
    log.i("no swap required");
  }

  /** signal ready */
  system.pub("ready");
}

async function up() {
  if (!services.ready) {
    log.e("services not yet ready yet and there is a sig-up!?");
    return;
  }

  const bw = services.blocklistWrapper;
  if (bw != null && !bw.disabled()) {
    await blocklists.setup(bw);
  } else {
    log.w("Config", "blocklists unavailable / disabled");
  }
  const lp = services.logPusher;
  if (lp != null) {
    try {
      await dbip.setup(lp);
    } catch (ex) {
      log.e("Config", "dbip setup failed", ex);
    }
  } else {
    log.w("Config", "logpusher unavailable");
  }

  process.on("SIGINT", (sig) => stopAfter());

  // signal all system are-a go
  system.pub("go");
}
