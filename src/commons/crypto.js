/*
 * Copyright (c) 2022 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// from: github.com/celzero/otp/blob/cddaaa03f12f/src/base/crypto.js#L1
// nb: stuble crypto api is global on node v19+
// stackoverflow.com/a/47332317
import { emptyBuf, fromStr, normalize8 } from "./bufutil.js";
import { emptyString } from "./util.js";

export const tktsz = 48;
export const hkdfalgkeysz = 32; // sha256
// hex: 9f34ba3c3c9097fef97e97effbb4bda4b9afa17dbb9b02f091a25d119ac91c5f
const fixedsalt = new Uint8Array([
  159, 52, 186, 60, 60, 144, 151, 254, 249, 126, 151, 239, 251, 180, 189, 164,
  185, 175, 161, 125, 187, 155, 2, 240, 145, 162, 93, 17, 154, 201, 28, 95,
]);

export async function tkt48(seed, ctx) {
  if (!emptyBuf(seed) && !emptyString(ctx)) {
    try {
      const sk256 = seed.slice(0, hkdfalgkeysz);
      const info512 = await sha512(fromStr(ctx));
      const dk512 = await gen(sk256, info512);
      return new Uint8Array(dk512.slice(0, tktsz));
    } catch (ignore) {}
  }
  const t = new Uint8Array(tktsz);
  crypto.getRandomValues(t);
  return t;
}

// salt for hkdf can be zero if secret is pseudorandom
// but a fixed salt is needed for high-entropy
// but non uniform keys like outputs of DHKE
async function gen(secret, info, salt = fixedsalt) {
  const key = await hkdfhmac(secret, info, salt);
  return crypto.subtle.exportKey("raw", key);
}

// with hkdf, salt is optional and public, but if used,
// for a given secret (Z) it needn't be unique per use,
// but it *must* be random:
// cendyne.dev/posts/2023-01-30-how-to-use-hkdf.html
// info adds entropy to extracted keys, and must be unique:
// see: soatok.blog/2021/11/17/understanding-hkdf
export async function hkdfhmac(skmac, usectx, salt = new Uint8Array(0)) {
  const dk = await hkdf(skmac);
  return await crypto.subtle.deriveKey(
    hkdf256(salt, usectx),
    dk,
    hmac256opts(),
    true, // extractable? can be true for sign, verify
    ["sign", "verify"] // usage
  );
}

export async function hkdfaes(skmac, usectx, salt = new Uint8Array(0)) {
  const dk = await hkdf(skmac);
  return crypto.subtle.deriveKey(
    hkdf256(salt, usectx),
    dk,
    aesgcm256opts(),
    true, // extractable? can be true for sign, verify
    ["encrypt", "decrypt"] // usage
  );
}

async function hkdf(sk) {
  return await crypto.subtle.importKey(
    "raw",
    sk,
    "HKDF",
    false, // extractable? always false for use as derivedKey
    ["deriveKey", "deriveBits"] // usage
  );
}

function hmac256opts() {
  return { name: "HMAC", hash: "SHA-256" }; // length: 512 (bits) default
}

function hkdf256(salt, usectx) {
  return { name: "HKDF", hash: "SHA-256", salt: salt, info: usectx };
}

export async function sha512(buf) {
  const ab = await crypto.subtle.digest("SHA-512", buf);
  return normalize8(ab);
}

/**
 * https://developer.mozilla.org/en-US/docs/Web/API/AesKeyGenParams
 * @returns {AesKeyGenParams}
 */
export function aesgcm256opts() {
  return {
    name: "AES-GCM",
    length: 256,
  };
}

/**
 *
 * @param {CryptoKey} aeskey
 * @param {BufferSource} iv
 * @param {BufferSource} plaintext
 * @param {BufferSource?} aad
 * @returns {Promise<Uint8Array>}
 * @throws {Error} if encryption fails
 */
export async function encryptAesGcm(aeskey, iv, plaintext, aad) {
  if (!aad || emptyBuf(aad)) {
    aad = undefined; // ZEROBUF is not the same as null?
  }
  /** @type {AesGcmParams} */
  const params = {
    name: "AES-GCM",
    iv: iv, // 96 bit (12 byte) nonce
    additionalData: aad, // optional
    tagLength: 128, // default (in bits)
  };
  const taggedciphertext = await crypto.subtle.encrypt(
    params,
    aeskey,
    plaintext
  );
  return normalize8(taggedciphertext);
}

/**
 * @param {CryptoKey} aeskey
 * @param {BufferSource} iv
 * @param {BufferSource} taggedciphertext
 * @param {BufferSource?} aad
 * @returns {Promise<Uint8Array>} - The decrypted plaintext
 * @throws {Error} - If decryption fails
 */
export async function decryptAesGcm(aeskey, iv, taggedciphertext, aad) {
  if (!aad || emptyBuf(aad)) {
    aad = undefined; // ZEROBUF is not the same as null?
  }
  /** @type {AesGcmParams} */
  const params = {
    name: "AES-GCM",
    iv: iv, // 96 bit (12 byte) nonce
    additionalData: aad, // optional
    tagLength: 128, // default (in bits)
  };
  const plaintext = await crypto.subtle.decrypt(
    params,
    aeskey,
    taggedciphertext
  );
  return normalize8(plaintext);
}

/**
 * @param {CryptoKey} ck - The HMAC key
 * @param {BufferSource} m - message to sign
 * @returns {Promise<ArrayBuffer>} - The HMAC signature
 * @throws {Error} - If the key is not valid or signing fails
 */
export function hmacsign(ck, m) {
  return crypto.subtle.sign("HMAC", ck, m);
}

/**
 * @param {CryptoKey} ck - The HMAC key
 * @param {ArrayBuffer} mac - The HMAC signature to verify
 * @param {BufferSource} m - The message to verify against
 * @returns {Promise<boolean>} - True if the signature is valid, false otherwise
 * @throws {Error} - If the key is not valid or verification fails
 */
export function hmacverify(ck, mac, m) {
  return crypto.subtle.verify("HMAC", ck, mac, m);
}
