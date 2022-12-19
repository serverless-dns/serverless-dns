/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as dnslib from "@serverless-dns/dns-parser";
import * as envutil from "./envutil.js";
import * as util from "./util.js";
import * as bufutil from "./bufutil.js";

// dns packet constants (in bytes)
// tcp msgs prefixed with 2-octet headers indicating request len in bytes
export const dnsHeaderSize = 2;
export const dnsPacketHeaderSize = 12;
export const minDNSPacketSize = dnsPacketHeaderSize + 5;
export const maxDNSPacketSize = 4096;

// TODO: move _dns* related settings to env
const _dnsCloudflareSec4 = "1.1.1.2";
const _dnsFly6 = "fdaa::3";
const _dnsCacheSize = 20000;

const _minRequestTimeout = 4000; // 4s
const _maxRequestTimeout = 30000; // 30s

export function dnsaddr() {
  // flydns is always ipv6 (fdaa::53)
  if (envutil.recursive()) return _dnsFly6;
  return _dnsCloudflareSec4;
}

export function cacheSize() {
  return _dnsCacheSize;
}

export function isAnswer(packet) {
  if (util.emptyObj(packet)) return false;

  return packet.type === "response";
}

export function servfail(qid, qs) {
  // qid == 0 is valid; in fact qid is set to 0 by most doh clients
  if (qid == null || qid < 0 || util.emptyArray(qs)) return null;

  return encode({
    id: qid,
    type: "response",
    flags: 4098, // servfail
    questions: qs,
  });
}

export function servfailQ(q) {
  if (bufutil.emptyBuf(q)) return null;

  try {
    const p = decode(q);
    return servfail(p.id, p.questions);
  } catch (e) {
    return null;
  }
}

export function requestTimeout() {
  const t = envutil.workersTimeout();
  return t > _minRequestTimeout
    ? Math.min(t, _maxRequestTimeout)
    : _minRequestTimeout;
}

export function truncated(ans) {
  if (bufutil.emptyBuf(ans)) return false;
  if (ans.byteLength < dnsPacketHeaderSize) return false;
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
  return !util.emptyObj(packet) && !util.emptyArray(packet.answers);
}

export function hasSingleQuestion(packet) {
  return (
    !util.emptyObj(packet) &&
    !util.emptyArray(packet.questions) &&
    packet.questions.length === 1
  );
}

export function rcodeNoError(packet) {
  if (util.emptyObj(packet)) return false;
  // github.com/mafintosh/dns-packet/blob/8e6d91c07/rcodes.js
  return packet.rcode === "NOERROR";
}

export function optAnswer(a) {
  if (util.emptyObj(a) || util.emptyString(a.type)) return false;
  // github.com/serverless-dns/dns-parser/blob/7de73303/index.js#L1770
  return a.type.toUpperCase() === "OPT";
}

export function decode(arrayBuffer) {
  if (!validResponseSize(arrayBuffer)) {
    throw new Error("failed decoding an invalid dns-packet");
  }

  const b = bufutil.bufferOf(arrayBuffer);
  return dnslib.decode(b);
}

export function encode(obj) {
  if (util.emptyObj(obj)) {
    throw new Error("failed encoding an empty dns-obj");
  }

  const b = dnslib.encode(obj);
  return bufutil.arrayBufferOf(b);
}

// TODO: All DNS Qs are blockable but only these may eventually
// result in a IP address answer, so we only block these. For now.
// FIXME: Missing ALT-SVC checks
export function isQueryBlockable(packet) {
  return (
    hasSingleQuestion(packet) &&
    (packet.questions[0].type === "A" ||
      packet.questions[0].type === "AAAA" ||
      packet.questions[0].type === "CNAME" ||
      packet.questions[0].type === "HTTPS" ||
      packet.questions[0].type === "SVCB")
  );
}

export function isAnswerBlockable(packet) {
  return isCname(packet) || isHttps(packet);
}

export function isAnswerDS(ans) {
  return !util.emptyObj(ans) && ans.type === "DS";
}

export function isAnswerRRSIG(ans) {
  return !util.emptyObj(ans) && ans.type === "RRSIG";
}

export function isAnswerDNSKEY(ans) {
  return !util.emptyObj(ans) && ans.type === "DNSKEY";
}

export function isAnswerRP(ans) {
  return !util.emptyObj(ans) && ans.type === "RP";
}

export function isAnswerTXT(ans) {
  return !util.emptyObj(ans) && ans.type === "TXT";
}

export function isAnswerNS(ans) {
  return !util.emptyObj(ans) && ans.type === "NS";
}

export function isAnswerOPT(ans) {
  return !util.emptyObj(ans) && ans.type === "OPT";
}

export function isAnswerMX(ans) {
  return !util.emptyObj(ans) && ans.type === "MX";
}

export function isAnswerCAA(ans) {
  return !util.emptyObj(ans) && ans.type === "CAA";
}

export function isAnswerSRV(ans) {
  return !util.emptyObj(ans) && ans.type === "SRV";
}

export function isAnswerHINFO(ans) {
  return !util.emptyObj(ans) && ans.type === "HINFO";
}

export function isAnswerSOA(ans) {
  return !util.emptyObj(ans) && ans.type === "SOA";
}

export function isAnswerOPTION(ans) {
  return !util.emptyObj(ans) && ans.type === "OPTION";
}

export function isAnswerA(ans) {
  return !util.emptyObj(ans) && ans.type === "A";
}

export function isAnswerAAAA(ans) {
  return !util.emptyObj(ans) && ans.type === "AAAA";
}

export function isCname(anspacket) {
  return hasAnswers(anspacket) && isAnswerCname(anspacket.answers[0]);
}

export function isAnswerCname(ans) {
  return !util.emptyObj(ans) && ans.type === "CNAME";
}

export function isHttps(anspacket) {
  return hasAnswers(anspacket) && isAnswerHttps(anspacket.answers[0]);
}

export function isAnswerHttps(ans) {
  return (
    !util.emptyObj(ans) &&
    !util.emptyString(ans.type) &&
    (ans.type === "HTTPS" || ans.type === "SVCB")
  );
}

export function isAnswerQuad0(packet) {
  if (!isQueryBlockable(packet)) return false;
  if (!hasAnswers(packet)) return false;
  for (const a of packet.answers) {
    if (a.data === "0.0.0.0" || a.data === "::") {
      return true;
    }
  }
  return false;
}

export function extractDomains(dnsPacket) {
  if (!hasSingleQuestion(dnsPacket)) return [];

  const names = new Set();
  const answers = dnsPacket.answers;

  const q = normalizeName(dnsPacket.questions[0].name);
  names.add(q);

  if (util.emptyArray(answers)) return [...names];

  // name                    ttl  cls  type    data
  // aws.amazon.com          57   IN   CNAME   frontier.amazon.com
  // frontier.amazon.com     57   IN   CNAME   3n1n2s.cloudfront.net
  // 3n1n2s.cloudfront.net   57   IN   A       54.230.149.75
  for (const a of answers) {
    if (a && !util.emptyString(a.name)) {
      const n = normalizeName(a.name);
      names.add(n);
    }
    if (isAnswerCname(a) && !util.emptyString(a.data)) {
      const n = normalizeName(a.data);
      names.add(n);
    } else if (
      isAnswerHttps(a) &&
      a.data &&
      !util.emptyString(a.data.targetName)
    ) {
      const n = normalizeName(a.data.targetName);
      // when ".", then target-domain is same as the question-domain
      if (n !== ".") names.add(n);
    } // else: name in answer not blockable
  }

  return [...names];
}

export function getAnswerTarget(packet) {
  // 40 chars is around enough to accomodate ipv6 addresses
  const maxdatalen = 40;
  if (!hasAnswers(packet)) {
    return packet.rcode;
  }
  let str = "";
  for (const a of packet.answers) {
    if (
      isAnswerA(a) ||
      isAnswerAAAA(a) ||
      isAnswerOPTION(a) ||
      isAnswerNS(a) ||
      isAnswerTXT(a)
    ) {
      // ns: github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L249
      // txt: github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L370
      // opt: github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L773
      str = a.data || "";
      break;
    } else if (isAnswerSOA(a)) {
      // github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L284
      str = a.data.mname;
      break;
    } else if (isAnswerHINFO(a)) {
      // github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L450
      str = a.data.os;
      break;
    } else if (isAnswerSRV(a)) {
      // github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L521
      str = a.data.target;
      break;
    } else if (isAnswerCAA(a)) {
      // github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L574
      str = a.data.value;
      break;
    } else if (isAnswerMX(a)) {
      // github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L618
      str = a.data.exchange;
      break;
    } else if (isAnswerRP(a)) {
      // github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L1027
      str = a.data.mbox;
      break;
    } else if (isAnswerHttps(a)) {
      // https/svcb answers may have a A / AAAA records
      // github.com/serverless-dns/dns-parser/blob/b7d73b3d/index.js#L1381
      const t = a.data.targetName;
      const kv = a.data.svcParams;
      if (t === ".") {
        if (util.emptyObj(kv)) continue;
        // if svcb/https is self-referential, then extract ip hints
        if (!util.emptyArray(kv.ipv4hint)) str = kv.ipv4hint[0];
        else if (!util.emptyArray(kv.ipv6hint)) str = kv.ipv6hint[0];
        else str = "";
        break;
      } else {
        str = t;
        continue;
      }
    } else if (isAnswerDNSKEY(a)) {
      // github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L914
      str = bufutil.bytesToBase64Url(a.data.key);
      break;
    } else if (isAnswerDS(a)) {
      // ds: github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L1279
      str = bufutil.bytesToBase64Url(a.data.digest);
      break;
    } else if (isAnswerRRSIG(a)) {
      // rrsig: github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L984
      str = bufutil.bytesToBase64Url(a.data.signature);
      break;
    } else if (isAnswerCname(a)) {
      str = a.data;
      continue;
    } else {
      // unhanlded types:
      // null, ptr, cname, ds, nsec, nsec3, nsec3param, tlsa, sshfp, spf, dname
      break;
    }
  }
  return util.strstr(str, 0, maxdatalen);
}

export function dohStatusCode(b) {
  if (!b || !b.byteLength) return 412;
  if (b.byteLength > maxDNSPacketSize) return 413;
  if (b.byteLength < minDNSPacketSize) return 400;
  return 200;
}

export function getQueryName(questions) {
  if (util.emptyArray(questions)) return false;

  const qn = normalizeName(questions[0].name);

  return util.emptyString(qn) ? false : qn;
}

export function getQueryType(packet) {
  if (!hasSingleQuestion(packet)) return false;

  const qt = packet.questions[0].type;

  return util.emptyString(qt) ? false : qt;
}

export function normalizeName(n) {
  if (util.emptyString(n)) return n;

  return n.trim().toLowerCase();
}
