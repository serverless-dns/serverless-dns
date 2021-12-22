/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

const _ENV_MAPPINGS = {
  runTime: "RUNTIME",
  runTimeEnv: {
    worker: "WORKER_ENV",
    node: "NODE_ENV",
    deno: "DENO_ENV",
  },
  cloudPlatform: "CLOUD_PLATFORM",
  logLevel: "LOG_LEVEL",
  blocklistUrl: "CF_BLOCKLIST_URL",
  latestTimestamp: "CF_LATEST_BLOCKLIST_TIMESTAMP",
  dnsResolverUrl: "CF_DNS_RESOLVER_URL",
  onInvalidFlagStopProcessing: {
    type: "boolean",
    all: "CF_ON_INVALID_FLAG_STOPPROCESSING",
  },

  //parallel request wait timeout for download blocklist from s3
  fetchTimeout: {
    type: "number",
    all: "CF_BLOCKLIST_DOWNLOAD_TIMEOUT",
  },

  //env variables for td file split
  tdNodecount: {
    type: "number",
    all: "TD_NODE_COUNT",
  },
  tdParts: {
    type: "number",
    all: "TD_PARTS",
  },

  //set to on - off aggressive cache plugin
  //as of now Cache-api is available only on worker
  //so _loadEnv will set this to false for other runtime.
  isAggCacheReq: {
    type: "boolean",
    worker: "IS_AGGRESSIVE_CACHE_REQ",
  },
};

function _loadEnv(runtime) {
  console.info("Loading env. from runtime: ", runtime);

  const env = {};
  for (const [key, value] of Object.entries(_ENV_MAPPINGS)) {
    let name = null;
    let type = "string";

    if (typeof value === "string") {
      name = value;
    } else if (typeof value === "object") {
      name = value.all || value[runtime];
      type = value.type || "string";
    }

    if (runtime === "node") env[key] = process.env[name];
    else if (runtime === "deno") env[key] = name && Deno.env.get(name);
    else if (runtime === "worker") env[key] = globalThis[name];
    else throw new Error(`Unknown runtime: ${runtime}`);

    // All env are assumed to be strings, so typecast them.
    if (type === "boolean") env[key] = !!env[key];
    else if (type === "number") env[key] = Number(env[key]);
  }

  return env;
}

function _getRuntime() {
  // As `process` also exists in worker, we need to check for worker first.
  if (globalThis.RUNTIME == "worker") return "worker";
  if (typeof Deno !== "undefined") return "deno";
  if (typeof process !== "undefined") return "node";
}

export default class EnvManager {
  constructor() {
    this.envMap = new Map();
    this.isLoaded = false;
  }
  /**
   * Loads env variables from runtime env. and is made globally available
   * through `env` namespace.
   */
  loadEnv() {
    const runtime = _getRuntime();
    const env = _loadEnv(runtime);
    for (const [key, value] of Object.entries(env)) {
      this.envMap.set(key, value);
    }

    //adding download timeout with worker time to determine worker's overall timeout
    runtime == "worker" &&
      this.envMap.set(
        "workerTimeout",
        Number(WORKER_TIMEOUT) + Number(CF_BLOCKLIST_DOWNLOAD_TIMEOUT)
      );

    console.debug(
      "Loaded env: ",
      (runtime == "worker" &&
        JSON.stringify(Object.fromEntries(this.envMap))) ||
        Object.fromEntries(this.envMap)
    );

    globalThis.env = Object.fromEntries(this.envMap); // Global `env` namespace.
    this.isLoaded = true;
  }
  getMap() {
    return this.envMap;
  }
  toObject() {
    return Object.fromEntries(this.envMap);
  }
  get(key) {
    return this.envMap.get(key);
  }
  put(key, value) {
    this.envMap.set(key, value);
    globalThis.env = Object.fromEntries(this.envMap);
  }
}
