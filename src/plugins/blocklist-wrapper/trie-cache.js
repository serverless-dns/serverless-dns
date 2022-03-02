/*
 * Copyright (c) 2022 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as envutil from "../../commons/envutil.js";
import { RangeLfu } from "@serverless-dns/lfu-cache";

export class TrieCache {
  constructor() {
    const name = "TrieNodeCache";

    const size = Math.floor(envutil.tdNodeCount() * 0.05);
    this.cache = new RangeLfu(name, size);
    this.log = log.withTags(name);
    this.log.i("setup capacity:", size);
  }

  get(n) {
    try {
      return this.cache.get(n);
    } catch (e) {
      this.log.e("get", n, e.stack);
    }
    return false;
  }

  put(lo, hi, val) {
    if (hi < lo || val == null) {
      this.log.w(val, "put not allowed hi < lo:", hi, "<", lo);
      return;
    }
    try {
      const frequency = Math.log2((hi - lo) ** 2) | 0;
      this.cache.put(lo, hi, val, frequency);
    } catch (e) {
      this.log.e("put", lo, hi, val, e.stack);
    }
  }

  find(n, cursor = null) {
    try {
      // returns {value: v, cursor: c}
      return this.cache.find(n, cursor);
    } catch (e) {
      this.log.e("find", n, cursor, e.stack);
    }
    return false;
  }
}
