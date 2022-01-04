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

const _dnsCloudflareSec = "1.1.1.2";
const _dnsCacheSize = 10000;

const _minRequestTimeout = 5000; // 7s
const _defaultRequestTimeout = 15000; // 15s
const _maxRequestTimeout = 30000; // 30s

const dns = new Dns();

export function dnsIpv4() {
  return _dnsCloudflareSec;
}

export function cacheSize() {
  return _dnsCacheSize;
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
  const t = envutil.workersTimeout(_defaultRequestTimeout);
  return t > _minRequestTimeout
    ? Math.min(t, _maxRequestTimeout)
    : _minRequestTimeout;
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

// TODO: All DNS Qs are blockable but only these may eventually
// result in a IP address answer, so we only block these. For now.
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
