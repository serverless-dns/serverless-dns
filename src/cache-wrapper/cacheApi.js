/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as envutil from "../helpers/envutil.js";
export class CacheApi {
  async get(url) {
    if (envutil.isWorkers()) {
      return await caches.default.match(url);
    }
    return false;
  }

  put(url, response) {
    if (envutil.isWorkers()) {
      return caches.default.put(url, response);
    }
    return false;
  }
}
