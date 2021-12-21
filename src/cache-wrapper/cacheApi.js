/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

export class CacheApi {
  constructor() {
    this.wCache = caches.default;
  }

  async get(url) {
    return await this.wCache.match(url);
  }

  put(url, response) {   
    this.wCache.put(url, response);
  }
}
