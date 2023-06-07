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

  /**
   * @param {URL} url
   * @param {boolean} localOnly
   * @returns {Promise<cacheutil.DnsCacheData?>}
   */
  async get(url, localOnly = false) {
    if (this.disabled) return null;

    if (!url && util.emptyString(url.href)) {
      this.log.d("get: empty url", url);
      return null;
    }

    // http-cache can be updated by any number of workers
    // in the region, and could contain latest / full
    // entry, whereas a local-cache may not.
    let data = this.fromLocalCache(url.href);
    if (data) {
      return data;
    }

    // fetch only from local-cache
    if (localOnly) return null;

    // note: http cache api availble only on cloudflare
    data = await this.fromHttpCache(url);
    if (data) {
      // write-through local cache
      this.putLocalCache(url.href, data);
    }

    return data;
  }

  /**
   * @param {URL} url
   * @param {cacheutil.DnsCacheData} data
   * @param {function(function):void} dispatcher
   * @returns {Promise<void>}
   */
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

      this.putLocalCache(url.href, data);

      dispatcher(this.putHttpCache(url, data));
    } catch (e) {
      this.log.e("put", url.href, data, e.stack);
    }
  }

  /**
   * @param {string} href
   * @param {cacheutil.DnsCacheData} data
   * @returns {void}
   */
  putLocalCache(href, data) {
    // href "https://caches.rethinkdns.com/2023/1682978161602/0.test.dns0.eu:A"
    // k "/0.test.dns0.eu:A"
    const k = href.slice(href.lastIndexOf("/"));
    const v = cacheutil.makeLocalCacheValue(data);

    if (!k || !v) return;

    this.localcache.put(k, v);
  }

  /**
   * @param {string} href
   * @returns {cacheutil.DnsCacheData|null}
   */
  fromLocalCache(href) {
    const key = href.slice(href.lastIndexOf("/"));
    if (!key) return false;

    const res = this.localcache.get(key);

    if (util.emptyObj(res)) return null;

    const b = res.dnsBuffer;
    const p = dnsutil.decode(b);
    const m = res.metadata;

    const cr = cacheutil.makeCacheValue(p, b, m);

    return cacheutil.isValueValid(cr) ? cr : null;
  }

  /**
   * @param {URL} url
   * @param {cacheutil.DnsCacheData} data
   * @returns
   */
  async putHttpCache(url, data) {
    const k = url.href;
    const v = cacheutil.makeHttpCacheValue(data);

    if (!k || !v) return;

    return this.httpcache.put(k, v);
  }

  /**
   * @param {URL} url
   * @returns {Promise<cacheutil.DnsCacheData|null>}
   */
  async fromHttpCache(url) {
    const k = url.href;
    const response = await this.httpcache.get(k);
    if (!response || !response.ok) return null;

    const metadata = cacheutil.extractMetadata(response);
    this.log.d("http-cache response metadata", metadata);

    // 'b' shouldn't be null; but a dns question or a dns answer
    const b = await response.arrayBuffer();
    // when 'b' is less than dns-packet header-size, decode errs out
    const p = dnsutil.decode(b);
    // though 'm' is never empty
    const m = metadata;

    const cr = cacheutil.makeCacheValue(p, b, m);

    return cacheutil.isValueValid(cr) ? cr : null;
  }
}
