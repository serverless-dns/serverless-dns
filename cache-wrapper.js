/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

var Cache = require('@serverless-dns/lfu-cache').LfuCache

class LocalCache {
  constructor(cacheName, size, cacheDataRemoveCount, sleepTime = 100) {
    this.localCache = new Cache(cacheName, size)
    this.cacheDataHold = []
    this.block = false
    this.cacheDataRemoveCount = cacheDataRemoveCount
    this.sleepTime = sleepTime
  }

  Get(key) {
    return this.localCache.Get(key)
  }
  Put(cacheData, event) {
    try {
      this.cacheDataHold.push(cacheData)
      if (!this.block) {
        this.block = true
        event.waitUntil(safeAdd.call(this))
      }
    }
    catch (e) {

    }
  }
}







async function safeAdd() {
  try {
    await sleep(this.sleepTime);
    var cacheData
    var count = 0
    while (cacheData = this.cacheDataHold.shift()) {
      count++
      this.localCache.Put(cacheData)
      if (count >= this.cacheDataRemoveCount)
        break
    }
    this.block = false
  }
  catch (e) {
    this.block = false
    let errobj = {}
    errobj.errat = "cache-wrapper.js safeAdd"
    errobj.errmsg = e.stack
  }
}
const sleep = ms => {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
};


module.exports.LocalCache = LocalCache