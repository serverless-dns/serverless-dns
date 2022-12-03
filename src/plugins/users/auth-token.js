/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as util from "../../commons/util.js";
import * as envutil from "../../commons/envutil.js";
import * as rdnsutil from "../../plugins/rdns-util.js";

const encoder = new TextEncoder();

/**
 * @param {{request: Request, isDnsMsg: Boolean, rxid: string}} param
 */
export async function auth(rxid, url) {
  const accesskey = envutil.accessKey();
  const u = new URL(url);

  // empty access key, allow all
  if (util.emptyString(accesskey)) {
    return true;
  }
  const msg = rdnsutil.msgkeyFromUrl(url);
  // if missing msg-key in url, deny
  if (util.emptyString(msg)) {
    log.w(rxid, "auth: stop! missing access-key in", url);
    return false;
  }
  // get domain.tld from a hostname like s1.s2.domain.tld
  const dom = u.hostname.split(".").slice(-2).join(".");
  const hex = await gen(msg, dom);

  log.d(rxid, msg, dom, "<= msg/h :auth: hex/k =>", hex, accesskey);

  // allow if access-key (upto its full len) matches calculated hex
  const ok = hex.startsWith(accesskey);

  if (!ok) {
    const h6 = hex.slice(0, 6);
    const a6 = accesskey.slice(0, 6);
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
  const u8 = encoder.encode(m + "|" + d);
  const b = await crypto.subtle.digest("SHA-256", encoder.encode(u8));

  // conv to base16, pad 0 for single digits, 01, 02, 03, ... 0f
  const hex = Array.from(new Uint8Array(b))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return hex;
}
