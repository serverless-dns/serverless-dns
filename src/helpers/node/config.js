/**
 * Configuration file for node runtime
 * - This module has side effects, sequentially setting up the environment.
 * - Only variables may be exported from this module.
 * - Don't define functions here, import functions if required.
 */

import { atob, btoa } from "buffer";
import fetch, { Headers, Request, Response } from "node-fetch";
import { getTLSfromEnv } from "./util.js";
import * as log from "../log.js";

/** Environment Variables */
// Load env variables from .env file to process.env (if file exists)
// NOTE: this won't overwrite existing
if (process.env.NODE_ENV !== "production") (await import("dotenv")).config();
process.env.RUNTIME_ENV = "node";

/** Logging level */
log.setLogLevel(process.env.LOG_LEVEL || "info");

/** Polyfills */
if (!globalThis.fetch) {
  globalThis.fetch =
    process.env.NODE_ENV !== "production"
      ? (await import("./util-dev.js")).fetchPlus
      : fetch;
  globalThis.Headers = Headers;
  globalThis.Request = Request;
  globalThis.Response = Response;
}

if (!globalThis.atob || !globalThis.btoa) {
  globalThis.atob = atob;
  globalThis.btoa = btoa;
}

/** TLS crt and key */
const _TLS_CRT_KEY =
  eval(`process.env.TLS_${process.env.TLS_CN}`) || process.env.TLS_;

export const [TLS_KEY, TLS_CRT] =
  process.env.NODE_ENV == "production" || _TLS_CRT_KEY != undefined
    ? getTLSfromEnv(_TLS_CRT_KEY)
    : (await import("./util-dev.js")).getTLSfromFile(
        process.env.TLS_KEY_PATH,
        process.env.TLS_CRT_PATH
      );

/** Swap on fly */
if (process.env.CLOUD_PLATFORM == "fly") {
  const ok = (await import("../setup.js")).mkswap();
  log.i("mkswap done?", ok);
}
