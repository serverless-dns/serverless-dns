/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/* For development environment use only */

import fetch from "undici";
import path from "path";
import * as fs from "fs";

/**
 * node-fetch with support for file:// urls
 * @param {RequestInfo} url
 * @param {RequestInit} [init]
 * @return {Promise<Response>}
 */
export function fetchPlus(url, init) {
  const request = new Request(url, init);

  if (!request.url.startsWith("file://")) {
    return fetch(url, init);
  }

  return new Promise((resolve, reject) => {
    const filePath = path.normalize(url.substring("file://".length));

    if (!fs.existsSync(filePath)) {
      reject(new Error(`File not found: ${filePath}`));
    } else {
      const readStream = fs.createReadStream(filePath);
      readStream.on("open", () => {
        resolve(new Response(readStream));
      });
    }
  });
}

/**
 * @param {String} TLS_KEY_PATH
 * @param {String} TLS_CRT_PATH
 * @return {Array<Buffer>} [TLS_KEY, TLS_CRT]
 */
export function getTLSfromFile(keyPath, crtPath) {
  return [fs.readFileSync(keyPath), fs.readFileSync(crtPath)];
}
