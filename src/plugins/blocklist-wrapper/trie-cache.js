/*
 * Copyright (c) 2022 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as envutil from "../../commons/envutil.js";
import { LfuCache } from "@serverless-dns/lfu-cache";

// disabling trie-cache until performance issues are sorted;
// on Workers, every 1ms increase in cpu time, increases gb-sec
// by 7x; and it is found that hammering lfu-cache as much as
// radixTrie.js:lookup is bound to do, cpu in p75 is up 2x at 9ms
const noop = true;

export class TrieCache {
  constructor() {
    const name = "TrieNodeCache";

    if (noop) return;

    const size = Math.floor(envutil.tdNodeCount() * 0.2);
    this.localCache = new LfuCache(name, size);
    this.log = log.withTags(name);
  }

  get(key) {
    if (noop) return false;

    return this.localCache.Get(key);
  }

  put(key, val) {
    if (noop) return;

    try {
      this.localCache.Put(key, val);
    } catch (e) {
      this.log.e("put", key, val, e.stack);
    }
  }
}
