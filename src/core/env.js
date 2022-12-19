/**
 * Instantiation of EnvManager class makes env values available through a
 * common interface.
 *
 * EnvManager.get() or EnvManager.set() allow manipulation of `env` object.
 * Environment variables of runtime (deno, node, worker)
 *
 * @license
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/**
 * @typedef {"number" | "string" | "boolean" | "csv"} EnvTyp
 * @typedef {string | number | boolean} EnvDefTyp
 * @typedef {EnvDefTyp|Set<string>} EnvConcreteTyp
 * @typedef {{type: EnvTyp, default: EnvDefTyp}} EnvDefs
 */

/**
 * @type {Map<String, EnvDefs>} defaults
 */
const defaults = new Map(
  Object.entries({
    // the env stage (production or development) workers is running in
    // development is always "local" (a laptop /a server, for example)
    WORKER_ENV: {
      type: "string",
      default: "development",
    },
    // the env stage deno is running in
    DENO_ENV: {
      type: "string",
      default: "development",
    },
    // the env stage nodejs is running in
    NODE_ENV: {
      type: "string",
      default: "development",
    },
    // the cloud-platform code is deployed on (cloudflare, fly, deno-deploy)
    CLOUD_PLATFORM: {
      type: "string",
      // also ref: EnvManager.mostLikelyCloudPlatform()
      default: "local",
    },
    // timeout for proc running on fly machines
    MACHINES_TIMEOUT_SEC: {
      type: "number",
      default: -1,
    },
    // download blocklist files to disk, if any, and quit
    BLOCKLIST_DOWNLOAD_ONLY: {
      type: "boolean",
      default: false,
    },
    // path to tls (private) key
    TLS_KEY_PATH: {
      type: "string",
      default: "test/data/tls/dns.rethinkdns.localhost.key",
    },
    // path to tls (public) cert chain
    TLS_CRT_PATH: {
      type: "string",
      default: "test/data/tls/dns.rethinkdns.localhost.crt",
    },
    // indicate if tls termination is offload to an external process; for ex
    // <appname>.fly.dev as primary access-point w fly.io edge terminating tls.
    TLS_OFFLOAD: {
      type: "boolean",
      default: false,
    },
    // global log level (debug, info, warn, error)
    LOG_LEVEL: {
      type: "string",
      default: "debug",
    },
    // url to blocklist files: trie (td), rank-dir (rd), metadata: (filetag)
    CF_BLOCKLIST_URL: {
      type: "string",
      default: "https://cfstore.rethinkdns.com/blocklists/",
    },
    // primary doh upstream
    CF_DNS_RESOLVER_URL: {
      type: "string",
      default: "https://cloudflare-dns.com/dns-query",
    },
    // secondary doh upstream
    CF_DNS_RESOLVER_URL_2: {
      type: "string",
      default: "https://dns.google/dns-query",
    },
    // upstream recursive rethinkdns resolver running on Fly.io
    MAX_DNS_RESOLVER_URL: {
      type: "string",
      // must always end with a trailing slash
      default: "https://max.rethinkdns.com/",
    },
    // max doh request processing timeout some requests may have to wait
    // for blocklists to download before being responded to.
    WORKER_TIMEOUT: {
      type: "number",
      default: "10000", // 10s
    },
    // max blocklist files download timeout
    CF_BLOCKLIST_DOWNLOAD_TIMEOUT: {
      type: "number",
      default: "7500", // 7.5s
    },
    // ttl for dns answers, overrides ttls in dns answers
    CACHE_TTL: {
      type: "number",
      default: "1800", // 30m
    },
    // disable downloading blocklists altogether
    DISABLE_BLOCKLISTS: {
      type: "boolean",
      default: false,
    },
    // treat all blocklists as wildcards, this means
    // if abc.xyz.com is in any blocklist, then
    // <*>.abc.xyz.com will also get blocked
    BLOCK_SUBDOMAINS: {
      type: "boolean",
      default: true,
    },
    // run in profiler mode
    PROFILE_DNS_RESOLVES: {
      type: "boolean",
      default: false,
    },
    // serve dns only when given a msgsecret sent in the request uri,
    // hash('msgsecret|domain.tld') equals ACCESS_KEY
    // Must be a hex string; see: simple-auth.js
    ACCESS_KEY: {
      type: "string",
      // for msg/key: 1123213213 and hostname: localhost
      // v = 6501611c59f36e4653d5b6f3e8be3bd6411996612a6315d59980388feb2ed594
      // For ex, DoH = 1:-J8AEH8Dv73_8______-___z6f9eagBA:1123213213
      // DoT = 1-7cpqaed7ao73377t777777767777h2p7lzvaaqa-1123213213
      // calc access key, v = hex(sha256("1123213213|domain.tld"))
      // nb, ACCESS_KEY, v, must be hex and upto 64 chars in length
      // while, 'msgsecret' must be a valid DNS name (alphanum + hyphen)
      // ACCESS_KEY, v, could be shorter (12 to 24 to 32 to 64 chars)
      // ACCESS_KEY, v, can be public (better if private / secret)
      default: "", // no auth when empty
    },
    // avoid using the (slow) fetch polyfill if on nodejs
    NODE_AVOID_FETCH: {
      type: "boolean",
      default: true,
    },
    // use only doh upstream on nodejs (udp/tcp is the default on nodejs)
    NODE_DOH_ONLY: {
      type: "boolean",
      default: false,
    },
    // cloudflare logpush: developers.cloudflare.com/workers/platform/logpush
    LOGPUSH_SRC: {
      type: "csv",
      default: "pro,one,log,local,localhost",
    },
    // Return 'Gateway IPs' for ALL eligible reqs (ref util.js:isGatewayRequest)
    GW_IP4: {
      type: "string",
      default: "",
    },
    GW_IP6: {
      type: "string",
      default: "",
    },
  })
);

/**
 * cast string x to type typ
 * @param {EnvDefTyp} x
 * @param {EnvTyp} typ
 * @returns {EnvConcreteTyp} casted value
 * @throws {Error}
 */
function caststr(x, typ) {
  if (typeof x === typ) return x;

  if (typ === "boolean") {
    return x === "true";
  } else if (typ === "number") {
    return Number(x);
  } else if (typ === "string") {
    return (x && x + "") || "";
  } else if (typ === "csv" && x instanceof Set) {
    return x;
  } else if (typ === "csv" && typeof x === "string") {
    return new Set(x.split(",").map((x) => x.trim()));
  } else {
    throw new Error(`unsupported type: ${typ}`);
  }
}

/**
 * @returns {string} runtime name
 */
function _determineRuntime() {
  if (typeof Deno !== "undefined") {
    return "deno";
  }

  if (globalThis.wenv) return "worker";

  if (typeof process !== "undefined") {
    // process also exists in Workers (miniflare), where wenv is defined
    if (process.env) return process.env.RUNTIME || "node";
  }

  return null;
}

export default class EnvManager {
  /**
   * Initializes the env manager.
   */
  constructor() {
    /** @type {string} */
    this.runtime = _determineRuntime();
    /** @type {Map<string, EnvConcreteTyp>} */
    this.envMap = new Map();
    this.load();
  }

  /**
   * Loads env variables from runtime env. and is made globally available
   * through `env` namespace. Existing env variables will be overwritten.
   */
  load() {
    this.envMap = this.defaultEnv();
    // verbose log:
    // console.debug("env defaults", this.envMap);
  }

  determineEnvStage() {
    if (this.runtime === "node") return this.get("NODE_ENV");
    if (this.runtime === "worker") return this.get("WORKER_ENV");
    if (this.runtime === "deno") return this.get("DENO_ENV");
    return null;
  }

  // most-likely but not definitive platform this code is running on
  mostLikelyCloudPlatform() {
    const isDev = this.determineEnvStage() === "development";
    // FLY_ALLOC_ID=5778f6b7-3cc2-d011-36b1-dfe057b0dc79 is set on fly-vms
    const hasFlyAllocId = this.get("FLY_ALLOC_ID") != null;
    // github.com/denoland/deploy_feedback/issues/73
    const hasDenoDeployId = this.get("DENO_DEPLOYMENT_ID") != null;
    const hasWorkersUa =
      typeof navigator !== "undefined" &&
      navigator.userAgent === "Cloudflare-Workers";

    if (hasFlyAllocId) return "fly";
    if (hasDenoDeployId) return "deno-deploy";
    if (hasWorkersUa) return "cloudflare";
    // if dev, then whatever is running is likely local
    if (isDev) return "local";
    // if prod, then node is likely running on fly
    if (this.runtime === "node") return "fly";
    // if prod, then deno is likely running on deno-deploy
    if (this.runtime === "deno") return "deno-deploy";
    // if prod, then worker is likely running on cloudflare
    if (this.runtime === "worker") return "cloudflare";

    return null;
  }

  /**
   * Makes default env values.
   * @return {Map} Runtime environment defaults.
   */
  defaultEnv() {
    const env = new Map();

    for (const [key, mappedKey] of defaults) {
      if (typeof mappedKey !== "object") continue;

      const type = mappedKey.type;
      const val = mappedKey.default;

      if (!type || val == null) {
        console.debug(key, "incomplete env val:", mappedKey);
        continue;
      }

      env.set(key, caststr(val, type));
    }

    env.set("CLOUD_PLATFORM", this.mostLikelyCloudPlatform());

    return env;
  }

  // one of deno, nodejs, or cloudflare workers
  r() {
    return this.runtime;
  }

  /**
   * Gets the value of an env variable.
   * @param {String} k - env variable name
   * @return {EnvConcreteTyp} - env variable value
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

    const m = defaults.get(k);
    // set default v when env var for k is not set
    if (m && v == null) v = m.default;

    // type-cast v as approp if k is among the defaults
    if (m && v != null) v = caststr(v, m.type);

    return v;
  }

  /**
   * @param {String} k - env name
   * @param {EnvDefTyp} v - env value
   * @param {EnvTyp} typ - env type, one of boolean, string, number, or csv
   */
  set(k, v, typ) {
    typ = typ || "string";
    this.envMap.set(k, caststr(v, typ));
  }
}
