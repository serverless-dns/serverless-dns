/*
 * Copyright (c) 2022 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import { Buffer } from "node:buffer";
import * as util from "./util.js";

export const ZERO = new Uint8Array();
const ZEROSTR = "";
export const ZEROAB = new ArrayBuffer();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function fromStr(s) {
  if (util.emptyString(s)) return ZERO;
  return encoder.encode(s);
}

export function toStr(b) {
  if (emptyBuf(b)) return ZEROSTR;
  return decoder.decode(b);
}

export function fromB64(b64std) {
  if (util.emptyString(b64std)) return ZERO;
  return Buffer.from(b64std, "base64");
}

export function toB64(buf) {
  if (emptyBuf(buf)) return ZEROSTR;
  if (buf instanceof Buffer) return buf.toString("base64");
  const u8 = normalize8(buf);
  return Buffer.of(u8).toString("base64");
}

export function hex(b) {
  if (emptyBuf(b)) return ZEROSTR;
  // avoids slicing Buffer (normalize8) to get hex
  if (b instanceof Buffer) return b.toString("hex");
  const ab = normalize8(b);
  return Array.prototype.map
    .call(new Uint8Array(ab), (b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * @param { Buffer | Uint8Array | ArrayBuffer } b
 * @returns {number}
 */
export function len(b) {
  if (emptyBuf(b)) return 0;
  return b.byteLength || 0;
}

export function bytesToBase64Url(b) {
  return btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\//g, "_")
    .replace(/\+/g, "-")
    .replace(/=/g, "");
}

function binaryStringToBytes(bs) {
  const len = bs.length;
  const bytes = new Uint8Array(len);

  for (let i = 0; i < len; i++) {
    bytes[i] = bs.charCodeAt(i);
  }

  return bytes;
}

function regularBase64(b64url) {
  if (util.emptyString(b64url)) return b64url;

  return b64url.replace(/_/g, "/").replace(/-/g, "+");
}

function base64ToUint8(b64uri) {
  b64uri = normalizeb64(b64uri);
  const b64url = decodeURI(b64uri);
  const binaryStr = atob(regularBase64(b64url));
  return binaryStringToBytes(binaryStr);
}

export function base64ToUint16(b64uri) {
  b64uri = normalizeb64(b64uri);
  const b64url = decodeURI(b64uri);
  const binaryStr = atob(regularBase64(b64url));
  return decodeFromBinary(binaryStr);
}

export function base64ToBytes(b64uri) {
  return raw(base64ToUint8(b64uri));
}

export function decodeFromBinary(b, u8) {
  // if b is a u8 array, simply u16 it
  if (u8) return new Uint16Array(raw(b));

  // if b is a binary-string, convert it to u8
  const bytes = binaryStringToBytes(b);
  // ...and then to u16
  return new Uint16Array(raw(bytes));
}

export function decodeFromBinaryArray(b) {
  const u8 = true;
  return decodeFromBinary(b, u8);
}

/**
 * @param {ArrayBufferLike} b
 * @returns {boolean}
 */
export function emptyBuf(b) {
  return !b || b.byteLength <= 0;
}

/**
 * Returns underlying buffer prop when b is TypedArray or node:Buffer
 * @param {Uint8Array|Buffer} b
 * @returns {ArrayBufferLike}
 */
export function raw(b) {
  if (!b || b.buffer == null) b = ZERO;

  return b.buffer;
}

// normalize8 returns the underlying buffer if any, as Uint8Array
// b is either an ArrayBuffer, a TypedArray, or a node:Buffer
export function normalize8(b) {
  if (emptyBuf(b)) return ZERO;

  let underlyingBuffer = null;
  // ... has byteLength property, b must be of type ArrayBuffer;
  if (b instanceof ArrayBuffer) underlyingBuffer = b;
  // when b is node:Buffer, this underlying buffer is not its
  // TypedArray equivalent: nodejs.org/api/buffer.html#bufbuffer
  // but node:Buffer is a subclass of Uint8Array (a TypedArray)
  // first though, slice out the relevant range from node:Buffer
  else if (b instanceof Buffer) underlyingBuffer = arrayBufferOf(b);
  else underlyingBuffer = raw(b);

  return new Uint8Array(underlyingBuffer);
}

/**
 * @param {Uint8Array|Buffer} buf
 * @returns {ArrayBuffer}
 */
export function arrayBufferOf(buf) {
  // buf is either TypedArray or node:Buffer
  if (emptyBuf(buf)) return ZEROAB;

  const offset = buf.byteOffset;
  const len = buf.byteLength;
  // slice creates a view when buf is node:Buffer, but:
  // slice creates a copy when buf is an TypedArray; otoh,
  // subarray creates a view for both TypedArray & node:Buffer
  // ref: nodejs.org/api/buffer.html#buffers-and-typedarrays.
  // what we want to return is an array-buffer after copying
  // the relevant contents from the the underlying-buffer.
  // stackoverflow.com/a/31394257
  return buf.buffer.slice(offset, offset + len);
}

// stackoverflow.com/a/17064149
export function bufferOf(arrayBuf) {
  if (emptyBuf(arrayBuf)) return ZERO;
  if (arrayBuf instanceof Uint8Array) return arrayBuf;

  return Buffer.from(new Uint8Array(arrayBuf));
}

/**
 * @param {Buffer} b
 * @returns {int}
 */
export function recycleBuffer(b) {
  b.fill(0);
  return 0;
}

/**
 * @param {int} size
 * @returns {Buffer}
 */
export function createBuffer(size) {
  return Buffer.allocUnsafe(size);
}

/**
 * Encodes a number to an Uint8Array of length `n` in Big Endian byte order.
 * https://stackoverflow.com/questions/55583037/
 * @param {Number} n - Number to encode
 * @param {Number} len - Length of Array required
 * @return {Uint8Array}
 */
export function encodeUint8ArrayBE(n, len) {
  const o = n;

  // all zeros...
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

// stackoverflow.com/a/40108543/
// Concatenate a mix of typed arrays
export function concat(arraybuffers) {
  const sz = arraybuffers.reduce((sum, a) => sum + a.byteLength, 0);
  const buf = new ArrayBuffer(sz);
  const cat = new Uint8Array(buf);
  let offset = 0;
  for (const a of arraybuffers) {
    // github: jessetane/array-buffer-concat/blob/7d79d5ebf/index.js#L17
    const v = new Uint8Array(a);
    cat.set(v, offset);
    offset += a.byteLength;
  }
  return buf;
}

export function concatBuf(these) {
  return Buffer.concat(these);
}

function normalizeb64(s) {
  // beware: atob(null) => \u009eée
  // and: decodeURI(null) => "null"
  // but: atob("") => ""
  // and: atob(undefined) => exception
  // so: convert null to empty str
  if (util.emptyString(s)) return "";
  else return s;
}
