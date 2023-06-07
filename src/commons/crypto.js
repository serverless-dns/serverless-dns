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
import { emptyBuf, fromStr } from "./bufutil.js";
import { emptyString } from "./util.js";

const tktsz = 48;
const hkdfalgkeysz = 32; // sha256

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

// salt for hkdf can be zero: stackoverflow.com/a/64403302
export async function gen(secret, info, salt = new Uint8Array()) {
  if (emptyBuf(secret) || emptyBuf(info)) {
    throw new Error("empty secret/info");
  }

  const key = await hkdfhmac(secret, info, salt);
  return crypto.subtle.exportKey("raw", key);
}

// with hkdf, salt is optional and public, but if used,
// for a given secret (Z) it needn't be unique per use,
// but it *must* be random:
// cendyne.dev/posts/2023-01-30-how-to-use-hkdf.html
// info adds entropy to extracted keys, and must be unique:
// see: soatok.blog/2021/11/17/understanding-hkdf
async function hkdfhmac(skmac, usectx, salt = new Uint8Array()) {
  const dk = await hkdf(skmac);
  return await crypto.subtle.deriveKey(
    hkdf256(salt, usectx),
    dk,
    hmac256opts(),
    true, // extractable? can be true for sign, verify
    ["sign", "verify"] // usage
  );
}

async function hkdf(sk) {
  return await crypto.subtle.importKey(
    "raw",
    sk,
    "HKDF",
    false, // extractable? always false for use as derivedKey
    ["deriveKey"] // usage
  );
}

function hmac256opts() {
  return { name: "HMAC", hash: "SHA-256" };
}

function hkdf256(salt, usectx) {
  return { name: "HKDF", hash: "SHA-256", salt: salt, info: usectx };
}

async function sha512(buf) {
  const ab = await crypto.subtle.digest("SHA-512", buf);
  return new Uint8Array(ab);
}
