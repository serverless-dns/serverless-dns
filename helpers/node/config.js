import { atob } from "buffer";
import fetch, { Headers, Request, Response } from "node-fetch";
import { getTLSfromEnv } from "./util.js";

// Load env variables from .env file to process.env (if file exists)
// NOTE: this won't overwrite existing
if (process.env.NODE_ENV !== "production") (await import("dotenv")).config();
process.env.RUNTIME_ENV = "node";

if (!globalThis.fetch) {
  globalThis.fetch = process.env.NODE_ENV !== "production"
    ? (await import("./util-dev.js")).fetchPlus
    : fetch;
  globalThis.Headers = Headers;
  globalThis.Request = Request;
  globalThis.Response = Response;
}

if (!globalThis.atob) {
  globalThis.atob = atob;
}

const TLS_CN = process.env.TLS_CN ?? "";
const TLS_CRT_KEY = eval(`process.env.TLS_${TLS_CN}`);

export const [TLS_KEY, TLS_CRT] =
  process.env.NODE_ENV == "production" || TLS_CRT_KEY != undefined
    ? getTLSfromEnv(TLS_CRT_KEY)
    : (await import("./util-dev.js")).getTLSfromFile(
      process.env.TLS_KEY_PATH,
      process.env.TLS_CRT_PATH,
    );
