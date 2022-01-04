/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as envutil from "../helpers/envutil.js";
import * as util from "../helpers/util.js";

export class CacheApi {
  constructor() {
    this.noop = !envutil.isWorkers();

    if (this.noop) {
      log.w("not workers, no-op http-cache-api");
    }
  }

  async get(url) {
    if (this.noop) return false;
    if (util.emptyString(url)) return false;

    return await caches.default.match(url);
  }

  put(url, response) {
    if (this.noop) return false;
    if (util.emptyString(url) || util.emptyObj(response)) return false;

    return caches.default.put(url, response);
  }
}
