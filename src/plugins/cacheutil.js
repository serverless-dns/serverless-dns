/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as util from "../commons/util.js";
import * as dnsutil from "../commons/dnsutil.js";
import * as envutil from "../commons/envutil.js";

const ttlGraceSec = 30; // 30s cache extra time
const cheader = "x-rdnscache-metadata";

export function isAnswerCacheable(dnsPacket) {
  // only noerror ans are cached, that means nxdomain
  // and ans with other rcodes are not cached at all.
  // btw, nxdomain ttls are in the authority section
  if (!dnsutil.rcodeNoError(dnsPacket)) return false;

  // if there are zero answers, there's nothing to cache
  if (!dnsutil.hasAnswers(dnsPacket)) return false;
  return true;
}

export function determineCacheExpiry(dnsPacket) {
  // expiresImmediately => dnsPacket is not an ans but a question
  const expiresImmediately = 0;

  // TODO: NXDOMAIN don't have an answers section
  // but NXDOMAINs aren't cached right now either
  if (!isAnswerCacheable(dnsPacket)) {
    return expiresImmediately;
  }

  // set min(ttl) among all answers, but at least ttlGraceSec
  let minttl = 1 << 30; // some abnormally high ttl

  for (const a of dnsPacket.answers) {
    minttl = Math.min(a.ttl || ttlGraceSec, minttl);
  }

  if (minttl === 1 << 30) {
    return expiresImmediately;
  }

  minttl = Math.max(minttl + ttlGraceSec, ttlGraceSec);
  const expiry = Date.now() + minttl * 1000;

  return expiry;
}

function makeCacheMetadata(dnsPacket, stamps) {
  return {
    expiry: determineCacheExpiry(dnsPacket),
    stamps: stamps,
  };
}

export function makeCacheValue(packet, metadata) {
  // null value allowed for packet
  return {
    dnsPacket: packet,
    metadata: metadata,
  };
}

export function cacheValueOf(packet, stamps) {
  const metadata = makeCacheMetadata(packet, stamps);
  return makeCacheValue(packet, metadata);
}

export function updateTtl(decodedDnsPacket, end) {
  const now = Date.now();
  const outttl = Math.max(
    Math.floor((end - now) / 1000) - ttlGraceSec,
    ttlGraceSec
  );
  for (const a of decodedDnsPacket.answers) {
    if (!dnsutil.optAnswer(a)) a.ttl = outttl;
  }
}

export function makePacketId(packet) {
  // multiple questions are kind of an undefined behaviour
  // stackoverflow.com/a/55093896
  if (!dnsutil.hasSingleQuestion(packet)) return null;

  const name = dnsutil.normalizeName(packet.questions[0].name);
  const type = packet.questions[0].type;
  return name + ":" + type;
}

export function makeHttpCacheValue(packet, metadata) {
  const b = dnsutil.encode(packet);

  const headers = {
    headers: util.concatHeaders(
      {
        "cheader": embedMetadata(metadata),
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

export function makeHttpCacheKey(url, id) {
  if (util.emptyString(id) || util.emptyObj(url)) return null;
  const origin = new URL(url).origin;
  return new URL(origin + "/" + envutil.timestamp() + "/" + id);
}

export function extractMetadata(cres) {
  return JSON.parse(cres.headers.get(cheader));
}

function embedMetadata(m) {
  return JSON.stringify(m);
}

export function updateQueryId(decodedDnsPacket, queryId) {
  if (queryId === decodedDnsPacket.id) return false; // no change
  decodedDnsPacket.id = queryId;
  return true;
}

export function isValueValid(v) {
  if (util.emptyObj(v)) return false;

  return hasMetadata(v.metadata);
}

export function hasMetadata(m) {
  return !util.emptyObj(m);
}

export function hasAnswer(v) {
  if (!hasMetadata(v.metadata)) return false;
  return isAnswerFresh(v.metadata);
}

export function isAnswerFresh(m) {
  // when expiry is 0, c.dnsPacket is a question and not an ans
  // ref: determineCacheExpiry
  return m.expiry > 0 && Date.now() <= m.expiry;
}
