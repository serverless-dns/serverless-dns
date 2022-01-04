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

function generateQuestionFilter(blf, dnsPacket) {
  const q = dnsPacket.questions[0].name;
  // computed property-names: stackoverflow.com/a/11508490
  return { [q]: util.objOf(blf.getDomainInfo(q).searchResult) };
}

function generateAnswerFilter(blf, dnsPacket) {
  if (dnsutil.isCname(dnsPacket)) {
    const ans = dnsutil.getCname(dnsPacket.answers);
    return newAnswerCacheFilter(blf, ans);
  } else if (dnsutil.isHttps(dnsPacket)) {
    const ans = dnsutil.getTargetName(dnsPacket);
    return newAnswerCacheFilter(blf, ans);
  }
  return {};
}

function newAnswerCacheFilter(blf, ans) {
  const f = {};
  for (const name of ans) {
    f[name] = util.objOf(blf.getDomainInfo(name).searchResult);
  }
  return f;
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
  const af = generateAnswerFilter(blf, dnsPacket);
  const qf = generateQuestionFilter(blf, dnsPacket);
  const ttl = determineCacheExpiry(dnsPacket);
  return {
    ttlEndTime: ttl,
    // TODO: NXDOMAIN don't have an answers section
    // but NXDOMAINs aren't cached right now either
    bodyUsed: dnsutil.hasAnswers(dnsPacket),
    cacheFilter: util.concatObj(af, qf),
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

  const name = packet.questions[0].name.trim().toLowerCase();
  const type = packet.questions[0].type;
  return name + ":" + type;
}

export function updateQueryId(decodedDnsPacket, queryId) {
  if (queryId === decodedDnsPacket.id) return false; // no change
  decodedDnsPacket.id = queryId;
  return true;
}
