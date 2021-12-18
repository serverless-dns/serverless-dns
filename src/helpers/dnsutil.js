/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { DNSParserWrap as Dns } from "../dns-operation/dnsOperation.js";

// dns packet constants (in bytes)
export const dnsHeaderSize = 2
export const minDNSPacketSize = 12 + 5
export const maxDNSPacketSize = 4096

const dns = new Dns();

// FIXME: must contain a question section
export const servfail = dns.Encode({
  type: "response",
  flags: 4098, // sets serv-fail flag
});

export function truncated(ans) {
  if (ans.length < 12) return false
  // first 2 bytes are query-id
  const flags = ans.readUInt16BE(2)
  // github.com/mafintosh/dns-packet/blob/8e6d91c0/index.js#L147
  const tc = (flags >> 9) & 0x1
  return tc === 1
}
