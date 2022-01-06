/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as util from "./util.js";
import * as dnsutil from "./dnsutil.js";

const ttlGraceSec = 30; // 30s cache extra time

function newCacheFilter(blf, domains) {
  const cf = {};

  if (util.emptyArray(domains)) return cf;

  for (const d of domains) {
    cf[d] = util.objOf(blf.getDomainInfo(d).searchResult);
  }
  return cf;
}

export function isCacheable(dnsPacket) {
  // only noerror ans are cached, that means nxdomain
  // and ans with other rcodes are not cached at all.
  // btw, nxdomain ttls are in the authority section
  if (!dnsutil.rcodeNoError(dnsPacket)) return false;

  // if there are zero answers, there's nothing to cache
  if (!dnsutil.hasAnswers(dnsPacket)) return false;
  return true;
}

export function determineCacheExpiry(dnsPacket) {
  const expiresImmediately = 0;

  if (!dnsutil.hasAnswers(dnsPacket)) return expiresImmediately;

  // set min(ttl) among all answers, but at least ttlGraceSec
  let minttl = 1 << 30; // some abnormally high ttl

  for (const a of dnsPacket.answers) {
    minttl = Math.min(a.ttl || minttl, minttl);
  }

  if (minttl === 1 << 30) return expiresImmediately;

  minttl = Math.max(minttl + ttlGraceSec, ttlGraceSec);
  const expiry = Date.now() + minttl * 1000;

  return expiry;
}

export function makeCacheMetadata(dnsPacket, blf) {
  const domains = dnsutil.extractDomains(dnsPacket);
  const cf = newCacheFilter(blf, domains);
  const ttl = determineCacheExpiry(dnsPacket);

  return {
    ttlEndTime: ttl,
    // TODO: NXDOMAIN don't have an answers section
    // but NXDOMAINs aren't cached right now either
    bodyUsed: dnsutil.hasAnswers(dnsPacket),
    cacheFilter: cf,
  };
}

export function createCacheInput(dnsPacket, blf) {
  return {
    dnsPacket: dnsPacket,
    metaData: makeCacheMetadata(dnsPacket, blf),
  };
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

export function cacheKey(packet) {
  // multiple questions are kind of an undefined behaviour
  // stackoverflow.com/a/55093896
  if (!dnsutil.hasSingleQuestion(packet)) return null;

  const name = dnsutil.normalizeName(packet.questions[0].name);
  const type = packet.questions[0].type;
  return name + ":" + type;
}

export function updateQueryId(decodedDnsPacket, queryId) {
  if (queryId === decodedDnsPacket.id) return false; // no change
  decodedDnsPacket.id = queryId;
  return true;
}

export function isValueValid(v) {
  if (util.emptyObj(v)) return false;

  return hasMetadata(v.metaData);
}

export function hasMetadata(m) {
  return !util.emptyObj(m);
}

export function hasAnswer(v) {
  if (!hasMetadata(v.metaData)) return false;
  return isAnswerFresh(v.metaData);
}

export function isAnswerFresh(m) {
  return m.bodyUsed && m.ttlEndTime > 0 && Date.now() <= m.ttlEndTime;
}
