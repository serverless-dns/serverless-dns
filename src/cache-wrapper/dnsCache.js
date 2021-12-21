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

export class DnsCache {
  constructor(size) {
    this.localCache = new Cache("DnsCache", size);
    this.cacheApi = new CacheApi();
  }

  async get(key, url) {
    let entry = this.getLocalCache(key);
    if (entry && Date.now() <= entry.metaData.ttlEndTime) {
      return entry;
    }
    if (url && envutil.isWorkers()) {
      entry = await validateCacheApiResponse(
        await this.cacheApi.get(makeCacheApiKey(key, url)),
      );
      if (entry) {
        this.putLocalCache(key, entry);
      }
    }
    return entry;
  }

  async put(key, data, url, buf) {
    this.putLocalCache(key, data);
    if (url && envutil.isWorkers()) {
      await this.putCacheApi(key, url, buf, data.metaData);
    }
  }

  putLocalCache(key, data) {
    try {
      this.localCache.Put(key, data);
    } catch (e) {
      console.error("Error At : DnsCache -> put");
      console.error(e.stack);
    }
  }
  getLocalCache(key) {
    return this.localCache.Get(key);
  }

  async putCacheApi(key, url, buf, metadata) {
    let response = createResponse(buf, metadata);
    this.cacheApi.put(makeCacheApiKey(key, url), response);
  }
}
function createResponse(buf, metaData) {
  return new Response(buf, {
    headers: {
      "Content-Length": buf.length,
      "x-rethink-metadata": JSON.stringify(metaData),
    },
    cf: { cacheTtl: 604800 },
  });
}

async function validateCacheApiResponse(response) {
  if (!response) return false;
  console.debug("Response found in Cache api");
  const metaData = JSON.parse(response.headers.get("x-rethink-metadata"));
  console.debug(metaData);
  if (metaData.bodyUsed && Date.now() >= metaData.ttlEndTime) {
    return false;
  }

  let data = {};
  data.decodedDnsPacket = metaData.bodyUsed ? dnsutil.dnsDecode(await response.arrayBuffer()) : {};
  data.metaData = metaData;
  console.debug(JSON.stringify(data));
  return data;
}

function makeCacheApiKey(key, url) {
  return new URL(new URL(url).origin + "/" + env.latestTimestamp + "/" + key);
}
