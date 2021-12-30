/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { DNSParserWrap as Dns } from "../dns-operation/dnsOperation.js";
import * as envutil from "./envutil.js";

// dns packet constants (in bytes)
// A dns message over TCP stream has a header indicating length.
export const dnsHeaderSize = 2;
export const dnsPacketHeaderSize = 12;
export const minDNSPacketSize = dnsPacketHeaderSize + 5;
export const maxDNSPacketSize = 4096;

export const dnsCloudflareSec = "1.1.1.2";
export const dnsCacheSize = 10000;
export const ttlGraceSec = 30;

const minRequestTimeout = 5000; // 7s
const defaultRequestTimeout = 15000; // 15s
const maxRequestTimeout = 30000; // 30s

const dns = new Dns();

export function dnsIpv4() {
  return dnsCloudflareSec;
}

export function cacheSize() {
  return dnsCacheSize;
}

export function servfail(qid, qs) {
  if (!qid || !qs) return null;

  return encode({
    id: qid,
    type: "response",
    flags: 4098, // servfail
    questions: qs,
  });
}

export function requestTimeout() {
  const t = envutil.workersTimeout(defaultRequestTimeout);
  return t > minRequestTimeout
    ? Math.min(t, maxRequestTimeout)
    : minRequestTimeout;
}

export function truncated(ans) {
  if (ans.length < dnsPacketHeaderSize) return false;
  // first 2 bytes are query-id
  const flags = ans.readUInt16BE(2);
  // github.com/mafintosh/dns-packet/blob/8e6d91c0/index.js#L147
  const tc = (flags >> 9) & 0x1;
  return tc === 1;
}

export function validResponseSize(r) {
  return r && validateSize(r.byteLength);
}

export function validateSize(sz) {
  return sz >= minDNSPacketSize && sz <= maxDNSPacketSize;
}

export function hasAnswers(packet) {
  return packet && packet.answers && packet.answers.length > 0;
}

export function hasSingleQuestion(packet) {
  return packet && packet.questions && packet.questions.length === 1;
}

export function rcodeNoError(packet) {
  // github.com/mafintosh/dns-packet/blob/8e6d91c07/rcodes.js
  return packet && packet.rcode === "NOERROR";
}

export function dnsqurl(dnsq) {
  return btoa(String.fromCharCode(...new Uint8Array(dnsq)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export function optAnswer(a) {
  // github.com/serverless-dns/dns-parser/blob/7de73303/index.js#L1770
  return a && a.type && a.type.toUpperCase() === "OPT";
}

export function encode(obj) {
  return dns.encode(obj);
}

export function decode(buf) {
  return dns.decode(buf);
}

export function isBlockable(packet) {
  return (
    hasSingleQuestion(packet) &&
    (packet.questions[0].type === "A" ||
      packet.questions[0].type === "AAAA" ||
      packet.questions[0].type === "CNAME" ||
      packet.questions[0].type === "HTTPS" ||
      packet.questions[0].type === "SVCB")
  );
}

export function cacheKey(packet) {
  // multiple questions are kind of an undefined behaviour
  // stackoverflow.com/a/55093896
  if (!hasSingleQuestion(packet)) return null;

  const name = packet.questions[0].name.trim().toLowerCase();
  const type = packet.questions[0].type;
  return name + ":" + type;
}

// TODO: move this function to cacheutil
export function updateTtl(decodedDnsPacket, end) {
  const now = Date.now();
  const outttl = Math.max(Math.floor((end - now) / 1000), /* grace*/ 30);
  for (const a of decodedDnsPacket.answers) {
    if (!optAnswer(a)) a.ttl = outttl;
  }
}

export function updateQueryId(decodedDnsPacket, queryId) {
  if (queryId === 0) return false; // doh reqs are qid free
  if (queryId === decodedDnsPacket.id) return false; // no change
  decodedDnsPacket.id = queryId;
  return true;
}

export function isCname(packet) {
  return hasAnswers(packet) && packet.answers[0].type === "CNAME";
}

export function isHttps(packet) {
  return (
    hasAnswers(packet) &&
    (packet.answers[0].type === "HTTPS" || packet.answers[0].type === "SVCB")
  );
}

export function getCname(answers) {
  const li = [];
  li[0] = answers[0].data.trim().toLowerCase();
  li[1] = answers[answers.length - 1].name.trim().toLowerCase();
  return li;
}

export function dohStatusCode(b) {
  if (!b || !b.byteLength) return 412;
  if (b.byteLength > maxDNSPacketSize) return 413;
  if (b.byteLength < minDNSPacketSize) return 400;
  return 200;
}

export function getTargetName(answers) {
  const tn = answers[0].data.targetName.trim().toLowerCase();
  if (tn === ".") return false;
  return tn;
}

export function getQueryName(questions) {
  const qn = questions[0].name.trim().toLowerCase();
  if (qn === "") return false;
  return qn;
}
