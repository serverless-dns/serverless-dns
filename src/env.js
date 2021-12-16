/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

export default class EnvManager {
  constructor() {
    this.env = new Map();
    this.isLoaded = false;
  }
  loadEnv() {
    try {
      this.env.set("runTimeEnv", RUNTIME_ENV);
      this.env.set("cloudPlatform", CLOUD_PLATFORM);
      this.env.set("blocklistUrl", CF_BLOCKLIST_URL);
      this.env.set("latestTimestamp", CF_LATEST_BLOCKLIST_TIMESTAMP);
      this.env.set("dnsResolverUrl", CF_DNS_RESOLVER_URL);
      //at worker all env variables are treated as plain text
      //so type cast is done for necessary variables
      this.env.set(
        "onInvalidFlagStopProcessing",
        (CF_ON_INVALID_FLAG_STOPPROCESSING == "true" ? true : false),
      );
      //adding download timeout with worker time to determine worker's overall timeout
      this.env.set(
        "workerTimeout",
        (parseInt(WORKER_TIMEOUT) + parseInt(CF_BLOCKLIST_DOWNLOAD_TIMEOUT)),
      );
      //parallel request wait timeout for download blocklist from s3
      this.env.set("fetchTimeout", parseInt(CF_BLOCKLIST_DOWNLOAD_TIMEOUT));

      //env variables for td file split
      this.env.set("tdNodecount", parseInt(TD_NODE_COUNT));
      this.env.set("tdParts", parseInt(TD_PARTS));

      //set to on - off aggressive cache plugin
      this.env.set(
        "isAggCacheReq",
        (IS_AGGRESSIVE_CACHE_REQ == "true" ? true : false),
      );

      this.isLoaded = true;
    } catch (e) {
      if (e instanceof ReferenceError) {
        typeof Deno !== "undefined" ? this.loadEnvDeno() : this.loadEnvNode();
      } else throw e;
    }

    // Make env available to all modules, globally
    globalThis.env = Object.fromEntries(this.env);
  }
  loadEnvDeno() {
    this.env.set("runTimeEnv", Deno.env.get("RUNTIME_ENV"));
    this.env.set("cloudPlatform", Deno.env.get("CLOUD_PLATFORM"));
    this.env.set("blocklistUrl", Deno.env.get("CF_BLOCKLIST_URL"));
    this.env.set(
      "latestTimestamp",
      Deno.env.get("CF_LATEST_BLOCKLIST_TIMESTAMP"),
    );
    this.env.set("dnsResolverUrl", Deno.env.get("CF_DNS_RESOLVER_URL"));
    this.env.set(
      "onInvalidFlagStopProcessing",
      Deno.env.get("CF_ON_INVALID_FLAG_STOPPROCESSING"),
    );

    //env variables for td file split
    this.env.set("tdNodecount", Deno.env.get("TD_NODE_COUNT"));
    this.env.set("tdParts", Deno.env.get("TD_PARTS"));

    //parallel request wait timeout for download blocklist from s3
    this.env.set("fetchTimeout", Deno.env.get("CF_BLOCKLIST_DOWNLOAD_TIMEOUT"));

    //set to on - off aggressive cache plugin
    //as of now Cache-api is available only on worker
    //so setting to false for DENO
    this.env.set("isAggCacheReq",false);
    this.isLoaded = true;
  }
  loadEnvNode() {
    this.env.set("runTimeEnv", process.env.RUNTIME_ENV);
    this.env.set("cloudPlatform", process.env.CLOUD_PLATFORM);
    this.env.set("blocklistUrl", process.env.CF_BLOCKLIST_URL);
    this.env.set(
      "latestTimestamp",
      process.env.CF_LATEST_BLOCKLIST_TIMESTAMP,
    );
    this.env.set("dnsResolverUrl", process.env.CF_DNS_RESOLVER_URL);
    this.env.set(
      "onInvalidFlagStopProcessing",
      process.env.CF_ON_INVALID_FLAG_STOPPROCESSING,
    );

    //env variables for td file split
    this.env.set("tdNodecount", process.env.TD_NODE_COUNT);
    this.env.set("tdParts", process.env.TD_PARTS);

    //parallel request wait timeout for download blocklist from s3
    this.env.set("fetchTimeout", process.env.CF_BLOCKLIST_DOWNLOAD_TIMEOUT);

    //set to on - off aggressive cache plugin
    //as of now Cache-api is available only on worker
    //so setting to false for fly
    this.env.set("isAggCacheReq",false);
    this.isLoaded = true;
  }
  getMap() {
    return this.env;
  }
  get(key) {
    return this.env.get(key);
  }
  put(key, value) {
    this.env.set(key, value);
    globalThis.env = Object.fromEntries(this.env);
  }
}
