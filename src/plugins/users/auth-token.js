/*
 * Copyright (c) 2023 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { LfuCache } from "@serverless-dns/lfu-cache";
import * as bufutil from "../../commons/bufutil.js";
import { hmackey, hmacsign, sha256 } from "../../commons/crypto.js";
import * as envutil from "../../commons/envutil.js";
import * as util from "../../commons/util.js";
import { log } from "../../core/log.js";
import * as rdnsutil from "../../plugins/rdns-util.js";

export const info = "sdns-public-auth-info";
const acachesize = 100;

export class Outcome {
  constructor(s) {
    this.status = s;
    // no auth or auth passed
    this.ok = s >= 0;
    // no auth or auth failed
    this.no = s <= 0;
    // auth passed
    this.yes = s === 1;
  }

  // no auth
  static none() {
    return new Outcome(0);
  }
  // auth passed
  static pass() {
    return new Outcome(1);
  }
  // auth failed
  static fail() {
    return new Outcome(-1);
  }
  // auth failed, missing msg-key
  static miss() {
    return new Outcome(-2);
  }
  // auth failed, internal error
  static err() {
    return new Outcome(-3);
  }
}

const akdelim = "|";
const msgkeydelim = "|";
const encoder = new TextEncoder();
const mem = new LfuCache("AuthTokens", acachesize);

/**
 * @param {string} rxid
 * @param {string} url
 * @returns {Promise<Outcome>}
 */
export async function auth(rxid, url) {
  const accesskeys = envutil.accessKeys();

  // empty access key, allow all
  if (util.emptySet(accesskeys)) {
    return Outcome.none();
  }
  const msg = rdnsutil.msgkeyFromUrl(url);
  // if missing msg-key in url, deny
  if (util.emptyString(msg)) {
    log.w(rxid, "auth: stop! missing access-key in", url);
    return Outcome.miss();
  }

  let ok = false;
  let a6 = "";
  // eval [s2.domain.tld, domain.tld] from a hostname
  // like s0.s1.s2.domain.tld
  for (const dom of util.domains(url)) {
    if (util.emptyString(dom)) continue;

    const [hex, hexcat] = await gen(msg, dom);

    log.d(rxid, msg, dom, "<= msg/h :auth: hex/k =>", hexcat, accesskeys);

    // allow if access-key (upto its full len) matches calculated hex
    for (const ak of accesskeys) {
      ok = hexcat.startsWith(ak);
      if (ok) {
        return Outcome.pass();
      } else {
        const [d, h] = ak.split(akdelim);
        a6 += d + akdelim + h.slice(0, 6) + " ";
      }
    }

    const h6 = dom + akdelim + hex.slice(0, 6);
    log.w(rxid, "auth: key mismatch want:", a6, "have:", h6);
  }

  log.w(rxid, "auth: stop! no matches");
  return Outcome.fail();
}

/**
 * Generate auth token pair for a given msg+domain.
 * @param {string} msg
 * @param {string} domain
 * @returns {Promise<[string, string]>} hex, domain|hex
 */
export async function gen(msg, domain) {
  if (util.emptyString(msg) || util.emptyString(domain)) {
    throw new Error(`args empty [${msg} / ${domain}]`);
  }

  // reject if msg is not alphanumeric
  if (!util.isAlphaNumeric(msg) || !util.isDNSName(domain)) {
    throw new Error("args must be alphanumeric");
  }

  const m = msg.toLowerCase();
  const d = domain.toLowerCase();

  return genInternal(m, d);
}

/**
 * @param {string} k1
 * @param {string} k2
 * @param {string} msg
 * @returns {Promise<[string, string]>} hex, k2|hex
 */
async function genInternal(k1, k2, msg = info) {
  // concat key1 + delim + key2
  const kcat = k1 + msgkeydelim + k2;
  // return memoized ans
  const cached = mem.get(kcat);
  if (cached) return cached;

  const k8 = encoder.encode(kcat);
  const m8 = encoder.encode(msg);
  const u8 = await proof(k8, m8);

  // conv to base16, pad 0 for single digits, 01, 02, 03, ... 0f
  const hex = bufutil.hex(u8);
  const hexcat = k2 + akdelim + hex;
  const toks = [hex, hexcat];

  mem.put(kcat, toks);
  return toks;
}

/**
 * Generate HMAC-SHA256 proof of val using key, or SHA256 of key if val is empty.
 * nb: stuble crypto api on node v19+
 * stackoverflow.com/a/47332317
 * @param {ArrayBuffer} key
 * @param {ArrayBuffer} val
 * @returns {Promise<Uint8Array>}
 */
export async function proof(key, val) {
  if (bufutil.emptyBuf(key)) {
    throw new Error("key array-buffer empty");
  }

  // use sha256 instead of hmac if nothing to sign
  if (bufutil.emptyBuf(val)) {
    return sha256(key);
  }

  const ck = await hmackey(key);

  return hmacsign(ck, val);
}
