/* For development environment use only */

import fetch from "node-fetch";
import path from "path";
import * as fs from "fs";

/**
 * node-fetch with support for file:// urls
 * @param {RequestInfo} url
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export function fetchPlus(url, init) {
  const request = new Request(url, init);
  if (request.url.startsWith("file://")) {
    return new Promise((resolve, reject) => {
      const filePath = path.normalize(url.substring("file://".length));

      if (!fs.existsSync(filePath)) {
        reject(
          new Error(`File not found: ${filePath}`),
        );
      } else {
        const readStream = fs.createReadStream(filePath);
        readStream.on("open", () => {
          resolve(new Response(readStream));
        });
      }
    });
  } else {
    return fetch(url, init);
  }
}

/**
 * @param {String} TLS_KEY_PATH
 * @param {String} TLS_CRT_PATH
 * @returns [TLS_KEY, TLS_CRT]
 */
export function getTLSfromFile(TLS_KEY_PATH, TLS_CRT_PATH) {
  return [
    fs.readFileSync(TLS_KEY_PATH),
    fs.readFileSync(TLS_CRT_PATH),
  ];
}
