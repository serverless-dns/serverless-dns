/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { LfuCache } from "@serverless-dns/lfu-cache";
import * as util from "../../commons/util.js";
import * as bufutil from "../../commons/bufutil.js";
import * as envutil from "../../commons/envutil.js";
import * as rdnsutil from "../../plugins/rdns-util.js";

export const info = "sdns-public-auth-info";
const akdelim = "|";
const msgkeydelim = "|";
const encoder = new TextEncoder();
const mem = new LfuCache("AuthTokens", 100);

/**
 * @param {{request: Request, isDnsMsg: Boolean, rxid: string}} param
 */
export async function auth(rxid, url) {
  const accesskeys = envutil.accessKeys();

  // empty access key, allow all
  if (util.emptySet(accesskeys)) {
    return true;
  }
  const msg = rdnsutil.msgkeyFromUrl(url);
  // if missing msg-key in url, deny
  if (util.emptyString(msg)) {
    log.w(rxid, "auth: stop! missing access-key in", url);
    return false;
  }
  // get domain.tld from a hostname like s1.s2.domain.tld
  const dom = util.tld(url);
  const [hex, hexcat] = await gen(msg, dom);

  log.d(rxid, msg, dom, "<= msg/h :auth: hex/k =>", hexcat, accesskeys);

  let ok = false;
  let a6 = "";
  // allow if access-key (upto its full len) matches calculated hex
  for (const accesskey of accesskeys) {
    ok = hexcat.startsWith(accesskey);
    if (ok) break;
    const [d, h] = accesskey.split(akdelim);
    a6 += d + akdelim + h.slice(0, 6) + " ";
  }

  if (!ok) {
    const h6 = dom + akdelim + hex.slice(0, 6);
    log.w(rxid, "auth: stop! key mismatch want:", a6, "have:", h6);
  }

  return ok;
}

export async function gen(msg, domain) {
  if (util.emptyString(msg) || util.emptyString(domain)) {
    throw new Error("args empty");
  }

  // reject if msg is not alphanumeric
  if (!util.isAlphaNumeric(msg) || !util.isDNSName(domain)) {
    throw new Error("args must be alphanumeric");
  }

  const m = msg.toLowerCase();
  const d = domain.toLowerCase();
  const cat = m + msgkeydelim + d;
  // return memoized ans
  const cached = mem.get(cat);
  if (cached) return cached;

  const k8 = encoder.encode(cat);
  const m8 = encoder.encode(info);
  const ab = await proof(k8, m8);

  // conv to base16, pad 0 for single digits, 01, 02, 03, ... 0f
  const hex = bufutil.hex(ab);
  const hexcat = domain + akdelim + hex;
  const toks = [hex, hexcat];

  mem.put(cat, toks);
  return toks;
}

// stackoverflow.com/a/47332317
async function proof(key, val) {
  const hmac = "HMAC";
  const sha256 = "SHA-256";

  if (bufutil.emptyBuf(key)) {
    throw new Error("key array-buffer empty");
  }

  // use sha256 instead of hmac if nothing to sign
  if (bufutil.emptyBuf(val)) {
    return await crypto.subtle.digest(sha256, key);
  }

  const hmackey = await crypto.subtle.importKey(
    "raw",
    key,
    {
      name: hmac,
      hash: { name: sha256 },
    },
    false, // export = false
    ["sign", "verify"]
  );

  // hmac sign & verify: stackoverflow.com/a/72765383
  return await crypto.subtle.sign(hmac, hmackey, val);
}
