/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { LfuCache as Cache } from "@serverless-dns/lfu-cache";
import { CacheApi as CacheApi } from "./cacheApi.js";
import * as dnsutil from "../helpers/dnsutil.js";
import * as envutil from "../helpers/envutil.js";
import * as util from "../helpers/util.js";

export class DnsCache {
  constructor(size) {
    this.localCache = new Cache("DnsCache", size);
    this.cacheApi = new CacheApi();
  }

  async get(key, url) {
    let entry = this.getLocalCache(key);
    if (
      entry && entry.metaData &&
      (!entry.metaData.bodyUsed || (Date.now() <= entry.metaData.ttlEndTime))
    ) {
      return entry;
    }

    //cache api not set
    if (!url || !envutil.isWorkers()) return false;

    const cacheApiKey = makeCacheApiKey(key, url);
    entry = await parseCacheApiResponse(await this.getCacheApi(cacheApiKey));
    //cache not available from cache api
    if (!entry) return false;
    this.putLocalCache(key, entry);
    return entry;
  }

  put(key, data, url, buf, event) {
    try {
      this.putLocalCache(key, data);
      //check for cache api availability
      if (url && envutil.isWorkers() && event && event.waitUntil) {
        console.debug("Adding to cache api");
        event.waitUntil(this.putCacheApi(key, url, buf, data.metaData));
      }
    } catch (e) {
      console.error(e.stack);
    }
  }

  putLocalCache(key, data) {
    try {
      console.debug("Adding to local cache");
      this.localCache.Put(key, data);
    } catch (e) {
      console.error("Error At : DnsCache -> put");
      console.error(e.stack);
    }
  }
  getLocalCache(key) {
    return this.localCache.Get(key);
  }

  async getCacheApi(key) {
    return await this.cacheApi.get(key);
  }
  async putCacheApi(key, url, buf, metaData) {
    let response = createResponse(buf, metaData, 604800); //1w ttl set based on blocklist update
    const cacheApiKey = makeCacheApiKey(key, url);
    this.cacheApi.put(cacheApiKey, response);
  }
}
function createResponse(buf, metaData, ttl) {
  return new Response(buf, httpHeaders(buf, metaData, ttl));
}

async function parseCacheApiResponse(response) {
  if (!response) return false;
  console.debug("Response found in Cache api");
  const metaData = JSON.parse(response.headers.get("x-rethink-metadata"));
  console.debug(metaData);
  if (!metaData || (metaData.bodyUsed && Date.now() >= metaData.ttlEndTime)) {
    return false;
  }

  let data = {};
  data.dnsPacket = metaData.bodyUsed
    ? dnsutil.decode(await response.arrayBuffer())
    : {};
  data.metaData = metaData;
  console.debug(JSON.stringify(data));
  return data;
}

function makeCacheApiKey(key, url) {
  return new URL(new URL(url).origin + "/" + env.latestTimestamp + "/" + key);
}

function httpHeaders(buf, metaData, ttl) {
  return {
    headers: util.concatHeaders(
      {
        "x-rethink-metadata": JSON.stringify(metaData),
      },
      util.contentLengthHeader(buf),
    ),
    cf: util.concatHeaders({ cacheTtl: ttl }),
  };
}
