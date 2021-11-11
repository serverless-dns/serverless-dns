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
    cacheDataRemoveCount,
    sleepTime = 100,
    runTimeEnv,
  ) {
    this.localCache = new Cache(cacheName, size);
    this.cacheDataHold = [];
    this.block = false;
    this.cacheDataRemoveCount = cacheDataRemoveCount;
    this.sleepTime = sleepTime;
    this.runTimeEnv = runTimeEnv || "worker";
  }

  Get(key) {
    return this.localCache.Get(key);
  }
  Put(cacheData, event) {
    try {
      if (this.runTimeEnv == "worker" || this.runTimeEnv == "deno") {
        this.cacheDataHold.push(cacheData);
        if (!this.block) {
          this.block = true;
          event.waitUntil
            ? event.waitUntil(safeAdd.call(this))
            : safeAdd.call(this);
        }
      }
    } catch (e) {
      console.error("Error At : LocalCache -> Put");
      console.error(e.stack);
    }
  }
}

async function safeAdd() {
  try {
    await sleep(this.sleepTime);
    var cacheData;
    var count = 0;
    while (cacheData = this.cacheDataHold.shift()) {
      count++;
      this.localCache.Put(cacheData);
      if (count >= this.cacheDataRemoveCount) {
        break;
      }
    }
    this.block = false;
  } catch (e) {
    this.block = false;
    console.error("Error At : LocalCache -> safeAdd" + this.localCache.lfuname);
    console.error(e.stack);
  }
}
const sleep = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};
