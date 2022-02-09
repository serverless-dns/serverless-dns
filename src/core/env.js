/**
 * Internal environment variables manager.
 *
 * Instantiation of EnvManager class will make a global variable `env` available
 * This class is recommended to globally available, as it can be instantiated
 * only once.
 * EnvManager.get() or EnvManager.set() allow manipulation of `env` object.
 * Environment variables of runtime (deno, node, worker) can be loaded via
 * EnvManager.loadEnv().
 *
 * @license
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

const defaults = {
  RUNTIME: {
    type: "string",
    default: _determineRuntime(),
  },
  WORKER_ENV: {
    type: "string",
    default: "development",
  },
  DENO_ENV: {
    type: "string",
    default: "development",
  },
  NODE_ENV: {
    type: "string",
    default: "development",
  },
  CLOUD_PLATFORM: {
    type: "string",
    // for local setups, platform is assumed to be fly.io since
    // the fly-vm is pretty close to a typical dev box setup
    default: "fly",
  },
  TLS_KEY_PATH: {
    type: "string",
    default: "test/data/tls/dns.rethinkdns.localhost.key",
  },
  TLS_CRT_PATH: {
    type: "string",
    default: "test/data/tls/dns.rethinkdns.localhost.crt",
  },
  LOG_LEVEL: {
    type: "string",
    default: "debug",
  },
  CF_BLOCKLIST_URL: {
    type: "string",
    default: "https://dist.rethinkdns.com/blocklists/",
  },
  CF_LATEST_BLOCKLIST_TIMESTAMP: {
    type: "string",
    default: "1638959365361",
  },
  CF_DNS_RESOLVER_URL: {
    type: "string",
    default: "https://cloudflare-dns.com/dns-query",
  },
  CF_DNS_RESOLVER_URL_2: {
    type: "string",
    default: "https://dns.google/dns-query",
  },
  WORKER_TIMEOUT: {
    type: "number",
    default: "10000", // 10s
  },
  CF_BLOCKLIST_DOWNLOAD_TIMEOUT: {
    type: "number",
    default: "5000", // 5s
  },
  TD_NODE_COUNT: {
    type: "number",
    default: "42112224",
  },
  TD_PARTS: {
    type: "number",
    default: "2",
  },
  CACHE_TTL: {
    type: "number",
    default: "1800", // 30m
  },
  DISABLE_BLOCKLISTS: {
    type: "boolean",
    default: false,
  },
  PROFILE_DNS_RESOLVES: {
    type: "boolean",
    default: false,
  },
  NODE_AVOID_FETCH: {
    type: "boolean",
    default: true,
  },
  NODE_DOH_ONLY: {
    type: "boolean",
    default: false,
  },
};

/**
 * Makes default env values.
 * @return {Object} Runtime environment variables.
 */
function defaultEnv() {
  const env = {};
  for (const [key, mappedKey] of Object.entries(defaults)) {
    if (typeof mappedKey !== "object") continue;

    const type = mappedKey.type;
    const val = mappedKey.default;

    if (!type || val == null) {
      console.debug(key, "incomplete env val:", mappedKey);
      continue;
    }

    env[key] = caststr(val, type);
  }

  return env;
}

function caststr(x, typ) {
  if (typeof x === typ) return x;

  if (typ === "boolean") return x === "true";
  else if (typ === "number") return Number(x);
  else if (typ === "string") return (x && x + "") || "";
  else throw new Error(`unsupported type: ${typ}`);
}

function _determineRuntime() {
  if (typeof Deno !== "undefined") {
    return Deno.env.get("RUNTIME") || "deno";
  }

  if (globalThis.wenv) return wenv.RUNTIME || "worker";

  if (typeof process !== "undefined") {
    // process also exists in Workers, where wenv is defined
    if (process.env) return process.env.RUNTIME || "node";
  }

  return null;
}

export default class EnvManager {
  /**
   * Initializes the env manager.
   */
  constructor() {
    this.runtime = _determineRuntime();
    this.envMap = new Map();
    this.load();
  }

  /**
   * Loads env variables from runtime env. and is made globally available
   * through `env` namespace. Existing env variables will be overwritten.
   */
  load() {
    const d = defaultEnv(this.runtime);

    for (const [k, v] of Object.entries(d)) {
      this.envMap.set(k, v);
    }

    console.debug(this.runtime, "defaults: ", JSON.stringify(d));
  }

  /**
   * @param {String} k - env variable name
   * @return {*} - env variable value
   */
  get(k) {
    let v = null;
    if (this.runtime === "node") {
      v = process.env[k];
    } else if (this.runtime === "deno") {
      v = Deno.env.get(k);
    } else if (this.runtime === "worker") {
      v = globalThis.wenv[k];
    }

    if (v == null) {
      v = this.envMap.get(k);
    }

    const m = defaults[k];
    if (m && v != null) v = caststr(v, m.type);

    return v;
  }

  /**
   * @param {String} k - env name
   * @param {*} v - env value
   * @param {*} typ - env type, one of boolean, string, or number
   */
  set(k, v, typ) {
    typ = typ || "string";
    this.envMap.set(k, caststr(v, typ));
  }
}
