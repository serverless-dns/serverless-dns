/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { LfuCache as Cache } from "@serverless-dns/lfu-cache";

export class DomainNameCache {
  constructor(size) {
    const name = "DomainNameCache";
    this.localCache = new Cache(name, size);
    this.log = log.withTags(name);
  }

  get(key) {
    return this.localCache.Get(key);
  }

  put(key, data) {
    try {
      this.localCache.Put(key, data);
    } catch (e) {
      this.log.e("put", e);
    }
  }
}
