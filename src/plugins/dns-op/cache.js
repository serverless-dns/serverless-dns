/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { LfuCache } from "@serverless-dns/lfu-cache";
import { CacheApi } from "./cache-api.js";
import * as bufutil from "../../commons/bufutil.js";
import * as dnsutil from "../../commons/dnsutil.js";
import * as envutil from "../../commons/envutil.js";
import * as util from "../../commons/util.js";
import * as cacheutil from "../cache-util.js";

export class DnsCache {
  constructor(size) {
    this.log = log.withTags("DnsCache");
    this.disabled = envutil.disableDnsCache();

    if (this.disabled) {
      this.log.w("DnsCache disabled");
      return;
    }

    this.localcache = new LfuCache("DnsCache", size);
    this.httpcache = new CacheApi();
  }

  async get(url, localOnly = false) {
    if (this.disabled) return null;

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

    // fetch only from local-cache
    if (localOnly) return null;

    // note: http cache api availble only on cloudflare
    entry = await this.fromHttpCache(url);

    if (entry) {
      // write-through local cache
      this.putLocalCache(url.href, entry);
    }

    return entry;
  }

  async put(url, data, dispatcher) {
    if (this.disabled) return;

    if (
      !url ||
      util.emptyString(url.href) ||
      util.emptyObj(data) ||
      util.emptyObj(data.metadata) ||
      util.emptyObj(data.dnsPacket) ||
      bufutil.emptyBuf(data.dnsBuffer)
    ) {
      this.log.w("put: empty url/data", url, data);
      return;
    }

    try {
      // data: {dnsPacket, dnsBuffer, metadata}; dnsPacket/Buffer may be null
      // verbose: this.log.d("put: data in cache", data);
      this.log.d("put: data in cache", data.metadata);

      // a race where the cache may infact have a fresh answer,
      // but then we override it with this question-only packet
      // so: get existing entry first to rule that out
      const c = this.fromLocalCache(url.href);
      const hasAns = !util.emptyObj(c) && dnsutil.isAnswer(c.dnsPacket);
      const incomingHasAns = dnsutil.isAnswer(data.dnsPacket);
      if (hasAns && !incomingHasAns) {
        this.log.w("put ignored: cache has answer, incoming does not");
        return;
      } // else: override cachedEntry with incoming

      this.putLocalCache(url, data);

      dispatcher(this.putHttpCache(url, data));
    } catch (e) {
      this.log.e("put", url.href, data, e.stack);
    }
  }

  putLocalCache(url, data) {
    const k = url.href;
    const v = cacheutil.makeLocalCacheValue(data.dnsBuffer, data.metadata);

    if (!k || !v) return;

    this.localcache.put(k, v);
  }

  fromLocalCache(key) {
    const res = this.localcache.get(key);

    if (util.emptyObj(res)) return false;

    const b = res.dnsBuffer;
    const p = dnsutil.decode(b);
    const m = res.metadata;

    const cr = cacheutil.makeCacheValue(p, b, m);

    return cacheutil.isValueValid(cr) ? cr : false;
  }

  async putHttpCache(url, data) {
    const k = url.href;
    const v = cacheutil.makeHttpCacheValue(data.dnsBuffer, data.metadata);

    if (!k || !v) return;

    return this.httpcache.put(k, v);
  }

  async fromHttpCache(url) {
    const k = url.href;
    const response = await this.httpcache.get(k);
    if (!response || !response.ok) return false;

    const metadata = cacheutil.extractMetadata(response);
    this.log.d("http-cache response metadata", metadata);

    // 'b' shouldn't be null; but a dns question or a dns answer
    const b = await response.arrayBuffer();
    // when 'b' is less than dns-packet header-size, decode errs out
    const p = dnsutil.decode(b);
    // though 'm' is never empty
    const m = metadata;

    const cr = cacheutil.makeCacheValue(p, b, m);

    return cacheutil.isValueValid(cr) ? cr : false;
  }
}
