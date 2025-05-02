/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as dnsutil from "../commons/dnsutil.js";
import * as envutil from "../commons/envutil.js";
import * as util from "../commons/util.js";
import * as pres from "./plugin-response.js";

const minTtlSec = 30; // 30s
const maxTtlSec = 180; // 3m
const expiresImmediately = 0; // 0s
const someVeryHighTtl = 1 << 30; // 2^30s
const cheader = "x-rdnscache-metadata";
const _cacheurl = "https://caches.rethinkdns.com/";

const _cacheHeaderKey = "x-rdns-cache";
const _cacheHeaderHitValue = "hit";
const _cacheHeaders = { [_cacheHeaderKey]: _cacheHeaderHitValue };

function determineCacheExpiry(packet) {
  // TODO: do not cache :: / 0.0.0.0 upstream answers?
  // expiresImmediately => packet is not an ans but a question
  if (!dnsutil.isAnswer(packet)) return expiresImmediately;

  let ttl = someVeryHighTtl;

  // TODO: nxdomain ttls are in the authority section
  // TODO: OPT answers need not set a ttl field
  // set min(ttl) among all answers, but at least minTtlSec
  for (const a of packet.answers) ttl = Math.min(a.ttl || minTtlSec, ttl);

  // if no answers, set min-ttl
  if (ttl === someVeryHighTtl) ttl = minTtlSec;

  // see also: isAnswerFresh
  ttl += envutil.cacheTtl();
  const expiry = Date.now() + ttl * 1000;

  return expiry; // in millis
}

/**
 * @param {any} dnsPacket
 * @param {pres.BStamp} stamps
 * @returns {DnsCacheMetadata}
 */
function makeCacheMetadata(dnsPacket, stamps) {
  // {
  //   "expiry": 1642874536022,
  //   "stamps": {
  //     "amazonaws.com": [128,2],
  //     "amazon.com": [16384,1024],
  //     "rewrite.amazon.com": [944,32768,8,16384,16,16]
  //   }
  // }
  return new DnsCacheMetadata(determineCacheExpiry(dnsPacket), stamps);
}

export class DnsCacheMetadata {
  constructor(expiry, stamps) {
    /** @type {number} */
    this.expiry = expiry;
    /** @type {pres.BStamp} */
    this.stamps = stamps;
  }
}

export class DnsCacheData {
  constructor(packet, raw, metadata) {
    /** @type {any} */
    this.dnsPacket = packet; // may be null
    /** @type {ArrayBuffer} */
    this.dnsBuffer = raw;
    /** @type {DnsCacheMetadata} */
    this.metadata = metadata;
  }
}

/**
 * @param {any} packet
 * @param {ArrayBuffer?} raw
 * @param {DnsCacheMetadata} metadata
 * @returns {DnsCacheData}
 */
export function makeCacheValue(packet, raw, metadata) {
  // null value allowed for packet / raw
  return new DnsCacheData(packet, raw, metadata);
}

/**
 * @param {pres.RespData} rdnsResponse
 * @returns {DnsCacheData}
 */
export function cacheValueOf(rdnsResponse) {
  const stamps = rdnsResponse.stamps;
  // do not cache OPT records
  // github.com/bluejekyll/trust-dns/blob/a614257fb0/crates/proto/src/rr/rdata/opt.rs#L46-L52
  const [packet, modified] = dnsutil.dropOPT(rdnsResponse.dnsPacket);
  const raw = modified ? dnsutil.encode(packet) : rdnsResponse.dnsBuffer;

  const metadata = makeCacheMetadata(packet, stamps);
  return makeCacheValue(packet, raw, metadata);
}

function updateTtl(packet, end) {
  const now = Date.now();
  const actualttl = Math.floor((end - now) / 1000) - envutil.cacheTtl();
  // jitter between min/max to prevent uniform expiry across clients
  const outttl =
    actualttl < minTtlSec ? util.rand(minTtlSec, maxTtlSec) : actualttl;
  for (const a of packet.answers) {
    if (!dnsutil.optAnswer(a)) a.ttl = outttl;
  }
}

export function makeId(packet) {
  // multiple questions are kind of an undefined behaviour
  // stackoverflow.com/a/55093896
  if (!dnsutil.hasSingleQuestion(packet)) return null;
  const q = packet.questions[0];
  const addn = dnsutil.hasDnssecOk(packet) ? ":dnssec" : "";
  return dnsutil.normalizeName(q.name) + ":" + q.type + addn;
}

/**
 * @param {DnsCacheData} data
 * @returns {DnsCacheData}
 */
export function makeLocalCacheValue(data) {
  const b = data.dnsBuffer;
  const metadata = data.metadata;
  // ensure dnsPacket is null
  return new DnsCacheData(null, b, metadata);
}

/**
 * @param {DnsCacheData} data
 * @returns {Response}
 */
export function makeHttpCacheValue(data) {
  const b = data.dnsBuffer;
  const metadata = data.metadata;
  const headers = {
    headers: util.concatHeaders(
      {
        [cheader]: embedMetadata(metadata),
        // ref: developers.cloudflare.com/workers/runtime-apis/cache#headers
        "Cache-Control": /* 1w*/ "max-age=604800",
      },
      util.contentLengthHeader(b)
    ),
    // if using the fetch web api, "cf" directive needs to be set, instead
    // ref: developers.cloudflare.com/workers/examples/cache-using-fetch
    // cf: { cacheTtl: /*1w*/ 604800 },
  };
  // http-cache stores Response objs:
  return new Response(b, headers);
}

/**
 * @param {any} packet
 * @param {ts} string
 * @returns {URL}
 */
export function makeHttpCacheKey(packet, ts) {
  const id = makeId(packet); // ex: domain.tld:A:dnssec
  if (util.emptyString(id)) return null;
  if (util.emptyString(ts)) ts = util.yyyymm();

  return new URL(_cacheurl + ts + "/" + id);
}

/**
 * @param {Response} cres
 * @returns {DnsCacheMetadata}
 */
export function extractMetadata(cres) {
  const j = JSON.parse(cres.headers.get(cheader));
  return new DnsCacheMetadata(j.expiry, j.stamps);
}

/**
 * @param {DnsCacheMetadata} m
 * @returns {string}
 */
function embedMetadata(m) {
  return JSON.stringify(m);
}

export function cacheHeaders() {
  return _cacheHeaders;
}

export function hasCacheHeader(h) {
  if (!h) return false;
  return h.get(_cacheHeaderKey) === _cacheHeaderHitValue;
}

function updateQueryId(decodedDnsPacket, queryId) {
  if (queryId === decodedDnsPacket.id) return false; // no change
  decodedDnsPacket.id = queryId;
  return true;
}

/**
 * @param {DnsCacheData} v
 * @returns {boolean}
 */
export function isValueValid(v) {
  if (util.emptyObj(v)) return false;

  return hasMetadata(v.metadata);
}

/**
 * @param {DnsCacheMetadata} m
 * @returns {boolean}
 */
export function hasMetadata(m) {
  return !util.emptyObj(m);
}

/**
 * @param {DnsCacheData} v
 * @returns {boolean}
 */
export function hasAnswer(v) {
  if (!hasMetadata(v.metadata)) return false;
  return isAnswerFresh(v.metadata, /* no roll*/ 6);
}

/**
 * @param {DnsCacheMetadata} m
 * @param {number} n
 * @returns {boolean}
 */
export function isAnswerFresh(m, n = 0) {
  // when expiry is 0, c.dnsPacket is a question and not an ans
  // ref: determineCacheExpiry
  const now = Date.now();
  const ttl = envutil.cacheTtl() * 1000;
  const r = n || util.rolldice(6);
  if (r % 6 === 0) {
    // 1 in 6 (~15% of the time), fresh if answer-ttl hasn't expired
    return m.expiry > 0 && now <= m.expiry - ttl;
  } else {
    // 5 in 6, fresh if cache-ttl hasn't expired, regardless of answer-ttl
    return m.expiry > 0 && now <= m.expiry;
  }
}

export function updatedAnswer(dnsPacket, qid, expiry) {
  updateQueryId(dnsPacket, qid);
  updateTtl(dnsPacket, expiry);
  return dnsPacket;
}
