/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as envutil from "../../commons/envutil.js";

export class CacheApi {
  constructor() {
    this.noop = !envutil.hasHttpCache();

    if (this.noop) {
      log.w("no-op http-cache-api");
    }
  }

  /**
   * @param {string} href
   * @returns {Promise<Response?>}
   */
  async get(href) {
    if (this.noop) return false;
    if (!href) return false;

    return await caches.default.match(href);
  }

  /**
   * @param {string} href
   * @param {Response} response
   * @returns
   */
  put(href, response) {
    if (this.noop) return false;
    if (!href || !response) return false;
    // todo: what does this return?
    return caches.default.put(href, response);
  }
}
