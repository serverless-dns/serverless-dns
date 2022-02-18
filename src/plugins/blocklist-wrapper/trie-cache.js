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

    const size = Math.floor(envutil.tdNodeCount() * 0.1);
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

  put(low, high, val) {
    try {
      this.cache.put(low, high, val);
    } catch (e) {
      this.log.e("put", low, high, val, e.stack);
    }
  }
}
