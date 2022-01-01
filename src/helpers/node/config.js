/**
 * Configuration file for node runtime
 * TODO: Remove all side-effects and use a constructor?
 * This module has side effects, sequentially setting up the environment.
 */

import { atob, btoa } from "buffer";
import fetch, { Headers, Request, Response } from "node-fetch";
import { getTLSfromEnv } from "./util.js";
import Log from "../log.js";
import * as system from "../../system.js";
import EnvManager from "../env.js";
import * as swap from "../linux/swap.js";

(async (main) => {
  // if this file execs... assume we're on nodejs.
  const runtime = "node";
  const isProd = process.env.NODE_ENV === "production";
  const onFly = process.env.CLOUD_PLATFORM === "fly";
  let devutils = null;
  let dotenv = null;

  // dev utilities
  if (!isProd) {
    devutils = await import("./util-dev.js");
    dotenv = await import("dotenv");
  }

  /** Environment Variables */
  // Load env variables from .env file to process.env (if file exists)
  // NOTE: this won't overwrite existing
  if (dotenv) {
    dotenv.config();
    console.log("loading local .env");
  }

  console.log("override runtime, from", process.env.RUNTIME, "to", runtime);
  process.env.RUNTIME = runtime; // must call before creating env-manager

  globalThis.envManager = new EnvManager();

  /** Logger */
  globalThis.log = new Log(
    env.logLevel,
    isProd // set console level only in prod.
  );

  /** TLS crt and key */
  // Raw TLS CERT and KEY are stored (base64) in an env var for fly deploys
  // (fly deploys are dev/prod nodejs deploys where env TLS_CN or TLS_ is set).
  // Otherwise, retrieve KEY and CERT from the filesystem (this is the case
  // for local non-prod nodejs deploys with self-signed certs).
  const _TLS_CRT_AND_KEY =
    eval(`process.env.TLS_${process.env.TLS_CN}`) || process.env.TLS_;

  if (isProd || _TLS_CRT_AND_KEY) {
    const [tlsKey, tlsCrt] = getTLSfromEnv(_TLS_CRT_AND_KEY);
    envManager.set("tlsKey", tlsKey);
    envManager.set("tlsCrt", tlsCrt);
    console.log("env (fly) tls setup");
  } else {
    const [tlsKey, tlsCrt] = devutils.getTLSfromFile(
      process.env.TLS_KEY_PATH,
      process.env.TLS_CRT_PATH
    );
    envManager.set("tlsKey", tlsKey);
    envManager.set("tlsCrt", tlsCrt);
    console.info("dev (local) tls setup");
  }

  /** Polyfills */
  if (!globalThis.fetch) {
    globalThis.fetch = isProd ? fetch : devutils.fetchPlus;
    globalThis.Headers = Headers;
    globalThis.Request = Request;
    globalThis.Response = Response;
    log.i("polyfill fetch web api");
  }

  if (!globalThis.atob || !globalThis.btoa) {
    globalThis.atob = atob;
    globalThis.btoa = btoa;
    log.i("polyfill atob / btoa");
  }

  /** Swap on Fly */
  if (onFly) {
    const ok = swap.mkswap();
    console.info("mkswap done?", ok);
  }

  /** signal up */
  system.pub("ready");
})();
