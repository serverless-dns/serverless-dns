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

const _dnsCacheSize = 30000;

const _minRequestTimeout = 4000; // 4s
const _maxRequestTimeout = 30000; // 30s

export function cacheSize() {
  return _dnsCacheSize;
}

export function isAnswer(packet) {
  if (util.emptyObj(packet)) return false;

  return packet.type === "response";
}

export function mkQ(qid, qs) {
  if (util.emptyArray(qs)) return null;

  return dnslib.encode({
    id: qid || 0,
    type: "query",
    questions: qs,
  });
}

export function servfail(qid, qs) {
  // qid == 0 is valid; in fact qid is set to 0 by most doh clients
  if (qid == null || qid < 0 || util.emptyArray(qs)) return bufutil.ZEROAB;

  return encode({
    id: qid,
    type: "response",
    flags: 4098, // servfail
    questions: qs,
  });
}

export function servfailQ(q) {
  if (bufutil.emptyBuf(q)) return bufutil.ZEROAB;

  try {
    const p = decode(q);
    return servfail(p.id, p.questions);
  } catch (e) {
    return bufutil.ZEROAB;
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

export function hasDnssecOk(packet) {
  if (util.emptyObj(packet)) return false;
  if (util.emptyArray(packet.additionals)) return false;
  // github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L1440
  // github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L1523
  // github.com/mafintosh/dns-packet/blob/31d3caf3/test.js#L407
  for (const a of packet.additionals) {
    if (a.flag_do || ((a.flags >> 15) & 0x1) === 1) return true;
  }
  return false;
}

/**
 * @param {any} packet
 * @returns {[any, boolean]}
 */
export function dropOPT(packet) {
  let rmv = false;
  if (util.emptyObj(packet)) return [packet, rmv];
  if (util.emptyArray(packet.additionals)) return [packet, rmv];
  /*
    additionals: [{
      name: '.', // same question as root
      type: 'OPT',
      udpPayloadSize: 4096,
      extendedRcode: 0,
      ednsVersion: 0,
      flags: 32768,
      flag_do: true, // dnssec ok
      options: [
        {}, {}, {} ...
      ],
    }, ... ]
  */
  const filtered = [];
  for (const a of packet.additionals) {
    if (optAnswer(a)) {
      // github.com/mafintosh/dns-packet/blob/7b6662025c/index.js#L711
      // case 3 (nsid), 10 (cookie) not encoded
      // case 5, 6, 7 not implemented
      // case 8 (ecs), 11 (keep-alive) discarded
      // case 12 (padding) discarded from caches
      // case 9 (expire), 13 (chain) experimental, not supported
      // case 14 (key-tag)
      rmv = true;
      continue;
    }
    filtered.push(a);
  }
  if (rmv) {
    packet.additionals = filtered;
  }
  return [packet, rmv];
}

export function dropECS(packet) {
  let rmv = false;
  if (util.emptyObj(packet)) return [packet, rmv];
  if (util.emptyArray(packet.additionals)) return [packet, rmv];
  /*
    additionals: [{
      name: '.', // same question as root
      type: 'OPT',
      udpPayloadSize: 4096,
      extendedRcode: 0,
      ednsVersion: 0,
      flags: 32768,
      flag_do: true, // dnssec ok
      options: [
        {
          code: 8,
          type: 'CLIENT_SUBNET',
          data: <bytes>,
          family: 1, // 2 for ipv6
          sourcePrefixLength: 32,
          scopePrefixLength: 0,
          ip: '100.64.0.0'
        },
        {
          code: 12,
          type: 'PADDING',
          data: <bytes>
        }
      ]
    },
    ...]
  */
  for (const a of packet.additionals) {
    if (!optAnswer(a)) continue;

    const filtered = [];
    for (const opt of a.options) {
      // github.com/mafintosh/dns-packet/blob/31d3caf3/test.js#L409-L412
      if (opt.code === 8 || opt.type === "CLIENT_SUBNET") {
        rmv = true;
        continue;
      }
      filtered.push(opt);
    }
    a.options = filtered;
  }
  return [packet, rmv];
}

// dup: isAnswerOPT
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

export function isQtypeA(qt) {
  return qt === "A";
}

export function isQtypeAAAA(qt) {
  return qt === "AAAA";
}

export function isQtypeCname(qt) {
  return qt === "CNAME";
}

export function isQtypeHttps(qt) {
  return qt === "HTTPS" || qt === "SVCB";
}

export function queryTypeMayResultInIP(t) {
  return isQtypeA(t) || isQtypeAAAA(t) || isQtypeCname(t) || isQtypeHttps(t);
}

export function queryMayResultInIP(q) {
  if (util.emptyObj(q)) return false;
  if (util.emptyString(q.type)) return false;

  return queryTypeMayResultInIP(q.type.toUpperCase());
}

// TODO: All DNS Qs are blockable but only these may eventually
// result in a IP address answer, so we only block these. For now.
// FIXME: Missing ALT-SVC checks
export function isQueryBlockable(packet) {
  if (!hasSingleQuestion(packet)) return false;
  const q = packet.questions[0];
  return queryMayResultInIP(q);
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

export function isIPGrounded(ip) {
  return ip === "0.0.0.0" || ip === "::";
}

export function isAnswerBlocked(ans) {
  for (const a of ans) {
    if (isIPGrounded(a.data)) {
      return true;
    }
  }
  return false;
}

export function isAnswerQuad0(packet) {
  if (!isQueryBlockable(packet)) return false;
  if (!hasAnswers(packet)) return false;
  return isAnswerBlocked(packet.answers);
}

export function ttl(packet) {
  if (!hasAnswers(packet)) return 0;
  return packet.answers[0].ttl || 0;
}

/**
 * @param {any} dnsPacket
 * @returns {string[]}
 */
export function extractDomains(dnsPacket) {
  if (!hasSingleQuestion(dnsPacket)) return [];

  /** @type {string} */
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

export function getInterestingAnswerData(packet, maxlen = 80, delim = "|") {
  if (!hasAnswers(packet)) {
    return !util.emptyObj(packet) ? packet.rcode || "WTF" : "WTF";
  }

  // set to true if at least one ip has been captured from ans
  let atleastoneip = false;
  let str = "";
  for (const a of packet.answers) {
    // gather twice the maxlen to capture as much as possible:
    // ips are usually prepend to the front, and going 2 times
    // over maxlen (chosen arbitrarily) maximises chances of
    // capturing IPs in A / AAAA records appearing later in ans
    if (atleastoneip && str.length > maxlen) break;
    if (!atleastoneip && str.length > maxlen * 2) break;

    if (isAnswerA(a) || isAnswerAAAA(a)) {
      const dat = a.data || "";
      // prepend A / AAAA data
      if (!util.emptyString(dat)) str = dat + delim + str;
      atleastoneip = true;
    } else if (isAnswerOPTION(a) || isAnswerNS(a) || isAnswerTXT(a)) {
      // ns: github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L249
      // txt: github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L370
      // opt: github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L773
      const dat = a.data || "";
      if (!util.emptyString(dat)) str += dat + delim;
    } else if (isAnswerSOA(a)) {
      // github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L284
      str += a.data.mname + delim;
    } else if (isAnswerHINFO(a)) {
      // github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L450
      str += a.data.os + delim;
      break;
    } else if (isAnswerSRV(a)) {
      // github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L521
      str += a.data.target + delim;
    } else if (isAnswerCAA(a)) {
      // github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L574
      str += a.data.value + delim;
    } else if (isAnswerMX(a)) {
      // github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L618
      str += a.data.exchange + delim;
    } else if (isAnswerRP(a)) {
      // github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L1027
      str += a.data.mbox + delim;
      break;
    } else if (isAnswerHttps(a)) {
      // https/svcb answers may have a A / AAAA records
      // github.com/serverless-dns/dns-parser/blob/b7d73b3d/index.js#L1381
      const t = a.data.targetName;
      const kv = a.data.svcParams;
      if (t === ".") {
        if (util.emptyObj(kv)) continue;
        // if svcb/https is self-referential, then prepend ip hints, if any
        if (
          !util.emptyArray(kv.ipv4hint) &&
          !util.emptyString(kv.ipv4hint[0])
        ) {
          str = kv.ipv4hint[0] + delim + str;
          atleastoneip = true;
        }
        if (
          !util.emptyArray(kv.ipv6hint) &&
          !util.emptyString(kv.ipv6hint[0])
        ) {
          str = kv.ipv6hint[0] + delim + str;
          atleastoneip = true;
        }
      } else {
        str += t + delim;
      }
    } else if (isAnswerDNSKEY(a)) {
      // github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L914
      str += bufutil.bytesToBase64Url(a.data.key) + delim;
      break;
    } else if (isAnswerDS(a)) {
      // ds: github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L1279
      str += bufutil.bytesToBase64Url(a.data.digest) + delim;
      break;
    } else if (isAnswerRRSIG(a)) {
      // rrsig: github.com/mafintosh/dns-packet/blob/31d3caf3/index.js#L984
      str += bufutil.bytesToBase64Url(a.data.signature) + delim;
      break;
    } else if (isAnswerCname(a)) {
      str += a.data + delim;
    } else {
      // unhanlded types:
      // null, ptr, ds, nsec, nsec3, nsec3param, tlsa, sshfp, spf, dname
      break;
    }
  }

  const trunc = util.strstr(str, 0, maxlen);
  const idx = trunc.lastIndexOf(delim);
  return idx >= 0 ? util.strstr(trunc, 0, idx) : trunc;
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

/**
 * @param {string?} n
 * @returns {string}
 */
export function normalizeName(n) {
  if (util.emptyString(n)) return n;

  return n.trim().toLowerCase();
}
