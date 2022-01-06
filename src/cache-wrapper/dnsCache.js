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
import * as cacheutil from "../helpers/cacheutil.js";

export class DnsCache {
  constructor(size) {
    this.localCache = new Cache("DnsCache", size);
    this.cacheApi = new CacheApi();
    this.log = log.withTags("DnsCache");
  }

  async get(key, url) {
    let entry = this.fromLocalCache(key);
    if (entry) {
      return entry;
    }

    // no http cache api on non-workers, yet
    if (!url || !envutil.isWorkers()) return false;

    const hKey = makeHttpCacheApiKey(key, url);
    entry = await this.fromHttpCacheApi(hKey);

    // write-through local cache
    this.putLocalCache(key, entry);

    return entry;
  }

  put(key, data, url, buf, event) {
    if (!key) return;

    try {
      this.putLocalCache(key, data);
      if (url && envutil.isWorkers() && event && event.waitUntil) {
        this.log.d("put data httpCache", data);
        event.waitUntil(this.putCacheApi(key, url, buf, data.metaData));
      }
    } catch (e) {
      this.log.e("put", e);
    }
  }

  putLocalCache(key, data) {
    if (!key || !data) return;
    try {
      this.localCache.Put(key, data);
    } catch (e) {
      this.log.e("putLocalCache", e);
    }
  }

  fromLocalCache(key) {
    if (!key) return false;

    const v = this.localCache.Get(key);
    return cacheutil.isValueValid(v) ? v : false;
  }

  async fromHttpCacheApi(key) {
    if (!key) return false;

    const cres = await this.cacheApi.get(key);
    return this.parseHttpCacheApiResponse(cres);
  }

  async putCacheApi(key, url, buf, metaData) {
    const k = makeHttpCacheApiKey(key, url);
    const v = makeHttpCacheApiValue(buf, metaData);

    if (!k || !v) return;

    this.cacheApi.put(k, v);
  }

  async parseHttpCacheApiResponse(response) {
    if (!response) return false;

    const metaData = JSON.parse(response.headers.get("x-rethink-metadata"));
    this.log.d("httpCache response metadata", metaData);

    if (!cacheutil.hasMetadata(metaData)) {
      return false;
    }

    const p = cacheutil.isAnswerFresh(metaData)
      ? dnsutil.decode(await response.arrayBuffer())
      : {};
    const m = metaData;

    return {
      // may be null
      dnsPacket: p,
      // never empty
      metaData: m,
    };
  }
}

function makeHttpCacheApiValue(buf, metaData) {
  const headers = {
    headers: util.concatHeaders(
      {
        "x-rethink-metadata": JSON.stringify(metaData),
        // ref: developers.cloudflare.com/workers/runtime-apis/cache#headers
        "Cache-Control": /* 1w*/ "max-age=604800",
      },
      util.contentLengthHeader(buf)
    ),
    // if using the fetch web api, "cf" directive needs to be set, instead
    // ref: developers.cloudflare.com/workers/examples/cache-using-fetch
    // cf: { cacheTtl: /*1w*/ 604800 },
  };
  return new Response(buf, headers);
}

function makeHttpCacheApiKey(key, url) {
  return new URL(new URL(url).origin + "/" + env.latestTimestamp + "/" + key);
}
