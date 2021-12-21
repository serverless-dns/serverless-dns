/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { DNSParserWrap as Dns } from "../dns-operation/dnsOperation.js"
import * as envutil from "./envutil.js"

// dns packet constants (in bytes)
// A dns message over TCP stream has a header indicating length.
export const dnsHeaderSize = 2
export const dnsPacketHeaderSize = 12
export const minDNSPacketSize = dnsPacketHeaderSize + 5
export const maxDNSPacketSize = 4096

const minRequestTimeout = 5000 // 7s
const defaultRequestTimeout = 15000 // 15s
const maxRequestTimeout = 30000 // 30s
const dns = new Dns()

export function servfail(qid, qs) {
  if (!qid || !qs) return null

  return dns.Encode({
    id: qid,
    type: "response",
    flags: 4098, // servfail
    questions: qs,
  })
}

export function requestTimeout() {
  const t = envutil.workersTimeout(defaultRequestTimeout)
  return (t > minRequestTimeout) ?
    Math.min(t, maxRequestTimeout) :
    minRequestTimeout
}

export function truncated(ans) {
  if (ans.length < dnsPacketHeaderSize) return false
  // first 2 bytes are query-id
  const flags = ans.readUInt16BE(2)
  // github.com/mafintosh/dns-packet/blob/8e6d91c0/index.js#L147
  const tc = (flags >> 9) & 0x1
  return tc === 1
}

export function validResponseSize(r) {
  return r && validateSize(r.byteLength)
}

export function validateSize(sz) {
  return sz >= minDNSPacketSize &&
    sz <= maxDNSPacketSize
}

export function hasAnswers(packet) {
  return packet && packet.answers && packet.answers.length > 0
}

export function rcodeNoError(packet) {
  // github.com/mafintosh/dns-packet/blob/8e6d91c07/rcodes.js
  return packet && packet.rcode === "NOERROR"
}

export function dnsqurl(dnsq) {
  return btoa(String.fromCharCode(...new Uint8Array(dnsq)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
}

export function optAnswer(a) {
  // github.com/serverless-dns/dns-parser/blob/7de73303/index.js#L1770
  return a && a.type && a.type.toUpperCase() === "OPT"
}

export function dohStatusCode(b) {
  if (!b || !b.byteLength) return 412
  if (b.byteLength > maxDNSPacketSize) return 413
  if (b.byteLength < minDNSPacketSize) return 400
  return 200
}
export function dnsEncode(obj){
  return dns.Encode(obj)
}

export function dnsDecode(buf){
  return dns.Decode(buf)
}
