/*
 * Copyright (c) 2022 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as envutil from "../../commons/envutil.js";
import { LfuCache } from "@serverless-dns/lfu-cache";

export class TrieCache {
  constructor() {
    const name = "TrieNodeCache";
    const size = Math.floor(envutil.tdNodeCount() * 0.2);
    this.localCache = new LfuCache(name, size);
    this.log = log.withTags(name);
  }

  get(key) {
    return this.localCache.Get(key);
  }

  put(key, val) {
    try {
      this.localCache.Put(key, val);
    } catch (e) {
      this.log.e("put", key, val, e.stack);
    }
  }
}
