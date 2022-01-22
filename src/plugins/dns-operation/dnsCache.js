/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { LfuCache } from "@serverless-dns/lfu-cache";
import { CacheApi } from "./cacheApi.js";
import * as dnsutil from "../../commons/dnsutil.js";
import * as util from "../../commons/util.js";
import * as cacheutil from "../cacheutil.js";

export class DnsCache {
  constructor(size) {
    this.localcache = new LfuCache("DnsCache", size);
    this.httpcache = new CacheApi();
    this.log = log.withTags("DnsCache");
  }

  async get(url) {
    if (!url && util.emptyString(url.href)) {
      this.log.d("get: empty url", url);
      return null;
    }

    // http-cache can be updated by any number of workers
    // in the region, and could contain latest / full
    // entry, whereas a local-cache may not.
    let entry = this.fromLocalCache(url.href);
    if (entry) {
      return entry;
    }

    // note: http cache api availble only on cloudflare
    entry = await this.fromHttpCache(url);

    if (entry) {
      // write-through local cache
      this.putLocalCache(url.href, entry);
    }

    return entry;
  }

  async put(url, data, dispatcher) {
    if (
      !url ||
      util.emptyString(url.href) ||
      util.emptyObj(data) ||
      util.emptyObj(data.metadata) ||
      util.emptyObj(data.dnsPacket)
    ) {
      this.log.w("put: empty url/data", url, data);
      return;
    }

    try {
      // data -> {dnsPacket, metadata}; dnsPacket may be null
      this.log.d("put: data in cache", data);

      this.putLocalCache(url.href, data);

      dispatcher(this.putHttpCache(url, data));
    } catch (e) {
      this.log.e("put", url.href, data, e.stack);
    }
  }

  putLocalCache(k, v) {
    if (!k || !v) return;

    this.localcache.Put(k, v);
  }

  fromLocalCache(key) {
    const v = this.localcache.Get(key);
    return cacheutil.isValueValid(v) ? v : false;
  }

  async putHttpCache(url, data) {
    const k = url.href;
    const v = cacheutil.makeHttpCacheValue(data.dnsPacket, data.metadata);

    if (!k || !v) return;

    return this.httpcache.put(k, v);
  }

  async fromHttpCache(url) {
    const k = url.href;
    const response = await this.httpcache.get(k);
    if (!response) return false;

    const metadata = cacheutil.extractMetadata(response);
    this.log.d("http-cache response metadata", metadata);

    if (!cacheutil.hasMetadata(metadata)) {
      return false;
    }

    // 'p' may be null or just a dns question or a dns answer
    const p = dnsutil.decode(await response.arrayBuffer());
    // though 'm' is never empty
    const m = metadata;

    return cacheutil.makeCacheValue(p, m);
  }
}
