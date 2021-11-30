/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

export default class Env {
  constructor() {
    this.env = new Map();
    this.isLoaded = false;
  }
  loadEnv() {
    try {
      this.env.set("runTimeEnv", RUNTIME_ENV);
      this.env.set("blocklistUrl", CF_BLOCKLIST_URL);
      this.env.set("latestTimestamp", CF_LATEST_BLOCKLIST_TIMESTAMP);
      this.env.set("dnsResolverUrl", CF_DNS_RESOLVER_URL);
      this.env.set(
        "onInvalidFlagStopProcessing",
        CF_ON_INVALID_FLAG_STOPPROCESSING,
      );
      this.env.set("workerTimeout", WORKER_TIMEOUT);

      //adding download timeout with worker time to determine worker's overall timeout
      this.env.set("workerTimeout", (WORKER_TIMEOUT + CF_BLOCKLIST_DOWNLOAD_TIMEOUT));
      //parallel request wait timeout for download blocklist from s3
      this.env.set("fetchTimeout", CF_BLOCKLIST_DOWNLOAD_TIMEOUT);
      //env variables for td file split
      this.env.set("tdNodecount", TD_NODE_COUNT);
      this.env.set("tdParts", TD_PARTS);

      this.isLoaded = true;
    } catch (e) {
      if (e instanceof ReferenceError) {
        typeof Deno !== "undefined" ? this.loadEnvDeno() : this.loadEnvNode();
      } else throw e;
    }
  }
  loadEnvDeno() {
    this.env.set("runTimeEnv", Deno.env.get("RUNTIME_ENV"));
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
    this.isLoaded = true;
  }
  loadEnvNode() {
    this.env.set("runTimeEnv", process.env.RUNTIME_ENV);
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
    this.isLoaded = true;
  }
  getEnvMap() {
    return this.env;
  }
  get(key) {
    return this.env.get(key);
  }
  put(key, value) {
    this.env.set(key, value);
  }
}
