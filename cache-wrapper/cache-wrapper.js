/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { LfuCache as Cache } from "@serverless-dns/lfu-cache";

export class LocalCache {
  constructor(
    cacheName,
    size,
  ) {
    this.localCache = new Cache(cacheName, size);
  }

  Get(key) {
    return this.localCache.Get(key);
  }
  Put(key, data) {
    try {
      this.localCache.Put(key, data);
    } catch (e) {
      console.error("Error At : LocalCache -> Put");
      console.error(e.stack);
    }
  }
}
