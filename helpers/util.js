/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/**
 * Encodes a number to an Uint8Array of length `n` in Big Endian byte order.
 * https://stackoverflow.com/questions/55583037/
 * @param {Number} n - Number to encode
 * @param {Number} len - Length of Array required
 * @returns
 */
export function encodeUint8ArrayBE(n, len) {
  const o = n;

  if (!n) return new Uint8Array(len);

  const a = [];
  a.unshift(n & 255);
  while (n >= 256) {
    n = n >>> 8;
    a.unshift(n & 255);
  }

  if (a.length > len) {
    throw new RangeError(`Cannot encode ${o} in ${len} len Uint8Array`);
  }

  let fill = len - a.length;
  while (fill--) a.unshift(0);

  return new Uint8Array(a);
}

export function fromBrowser(req) {
  if (!req || !req.headers) return false;
  const ua = req.headers.get("User-Agent");
  return ua && ua.startsWith("Mozilla/5.0");
}

export function jsonHeaders(res) {
  res.headers.set("Content-Type", "application/json");
}

export function dnsHeaders(res) {
  res.headers.set("Content-Type", "application/dns-message");
}

export function corsHeaders(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Headers", "*");
}

export function browserHeaders(res) {
  jsonHeaders(res);
  corsHeaders(res);
}

export function dohHeaders(req, res) {
  dnsHeaders(res);
  // allow cors when reqs from agents claiming to be browsers
  if (fromBrowser(req)) corsHeaders(res);
}

/**
 * Promise that resolves after `ms`
 * @param {number} ms - Milliseconds to sleep
 * @returns
 */
export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

