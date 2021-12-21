/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import { Buffer } from "buffer"

/**
 * Encodes a number to an Uint8Array of length `n` in Big Endian byte order.
 * https://stackoverflow.com/questions/55583037/
 * @param {Number} n - Number to encode
 * @param {Number} len - Length of Array required
 * @returns
 */
export function encodeUint8ArrayBE(n, len) {
  const o = n;

  if (!n) return new Uint8Array(len)

  const a = [];
  a.unshift(n & 255)
  while (n >= 256) {
    n = n >>> 8;
    a.unshift(n & 255)
  }

  if (a.length > len) {
    throw new RangeError(`Cannot encode ${o} in ${len} len Uint8Array`)
  }

  let fill = len - a.length
  while (fill--) a.unshift(0)

  return new Uint8Array(a)
}

export function fromBrowser(req) {
  if (!req || !req.headers) return false

  const ua = req.headers.get("User-Agent")
  return ua && ua.startsWith("Mozilla/5.0")
}

export function jsonHeaders() {
  return {
    "Content-Type": "application/json",
  }
}

export function dnsHeaders() {
  return {
    "Accept": "application/dns-message",
    "Content-Type": "application/dns-message",
  }
}

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
  }
}

export function corsHeadersIfNeeded(req) {
  // allow cors when reqs from agents claiming to be browsers
  return (fromBrowser(req)) ? corsHeaders() : {}
}

export function browserHeaders() {
  return Object.assign(
    jsonHeaders(),
    corsHeaders(),
  );
}

export function dohHeaders(req) {
  return Object.assign(
    dnsHeaders(),
    corsHeadersIfNeeded(req),
  )
}

export function contentLengthHeader(b) {
  const len = (!b || !b.byteLength) ? "0" : b.byteLength.toString()
  return { "Content-Length" : len }
}

export function concatHeaders() {
  return Object.assign(...arguments)
}

export function copyHeaders(req) {
  const headers = {}
  if (!req || !req.headers) return headers

  // Object.assign, Object spread, etc don't work
  req.headers.forEach((val, name) => {
    headers[name] = val
  })
  return headers
}

export function copyNonPseudoHeaders(req) {
  const headers = {}
  if (!req || !req.headers) return headers

  // drop http/2 pseudo-headers
  for (const name in req.headers) {
    if (name.startsWith(":")) continue
    headers[name] = req.headers[name]
  }
  return headers
}

/**
 * Promise that resolves after `ms`
 * @param {number} ms - Milliseconds to sleep
 * @returns
 */
export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  });
}

export function objOf(map) {
  return map.entries ? Object.fromEntries(map) : false
}

// stackoverflow.com/a/31394257
export function arrayBufferOf(buf) {
  if (!buf) return null

  const offset = buf.byteOffset
  const len = buf.byteLength
  return buf.buffer.slice(offset, offset + len)
}

// stackoverflow.com/a/17064149
export function bufferOf(arrayBuf) {
  if (!arrayBuf) return null

  return Buffer.from(new Uint8Array(arrayBuf))
}

export function recycleBuffer(b) {
  b.fill(0)
  return 0
}

export function createBuffer(size) {
  return Buffer.allocUnsafe(size)
}

export function timedOp(op, ms, cleanup) {
  let tid = null
  let resolve = null
  let reject = null
  const promiser = (accept, deny) => {
    resolve = accept
    reject = deny
  }
  const p = new Promise(promiser)

  let timedout = false
  tid = timeout(ms, () => {
    timedout = true
    reject("timeout")
  })

  try {
    op((out, ex) => {
      if (timedout) {
        cleanup(out)
        return
      }

      clearTimeout(tid)

      if (ex) {
        reject(ex.message)
      } else {
        resolve(out)
      }
    })
  } catch (ex) {
    if (!timedout) reject(ex.message)
  }
  return p
}

export function timeout(ms, callback) {
  return setTimeout(callback, ms)
}

// stackoverflow.com/a/8084248
export function uid() {
  // ex: ".ww8ja208it"
  return (Math.random() + 1).toString(36).slice(1)
}

export function safeBox(fn, defaultResponse = null) {
  try {
    return fn()
  } catch (ignore) {}
  return defaultResponse
}

export function isDnsMsg(req) {
  return req.headers.get("Accept") === "application/dns-message" ||
    req.headers.get("Content-Type") === "application/dns-message"
}

export function emptyResponse() {
  return {
    isException: false,
    exceptionStack: "",
    exceptionFrom: "",
    data: {
      responseDecodedDnsPacket: null,
      responseBodyBuffer: null,
    },
  }
}

export function errResponse(id, err) {
  return {
    isException: true,
    exceptionStack: err.stack,
    exceptionFrom: id,
    data: false,
  }
}
