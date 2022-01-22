/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import { DnsBlocker } from "./dnsBlock.js";
import * as cacheutil from "../cacheutil.js";
import * as rdnsutil from "../dnsblockutil.js";
import * as dnsutil from "../../commons/dnsutil.js";
import * as util from "../../commons/util.js";

export class DNSCacheResponder {
  constructor(cache) {
    this.blocker = new DnsBlocker();
    this.log = log.withTags("DnsCacheResponse");
    this.cache = cache;
  }

  /**
   * @param {*} param
   * @param {*} param.userBlocklistInfo
   * @param {*} param.requestDecodedDnsPacket
   * @param {*} param.isDnsMsg
   * @returns
   */
  async RethinkModule(param) {
    let response = util.emptyResponse();
    if (!param.isDnsMsg) {
      this.log.d(param.rxid, "not a dns-msg, nowt to resolve");
      return response;
    }

    try {
      response.data = await this.resolveFromCache(param);
    } catch (e) {
      this.log.e(param.rxid, "main", e.stack);
      response = util.errResponse("DnsCacheHandler", e);
    }

    return response;
  }

  async resolveFromCache(param) {
    const noAnswer = rdnsutil.rdnsNoBlockResponse();

    const rxid = param.rxid;
    const packet = param.requestDecodedDnsPacket;

    const k = cacheutil.makeHttpCacheKey(packet);
    if (!k) return noAnswer;

    const cr = await this.cache.get(k);
    this.log.d(param.rxid, "resolveFromCache k/v", k.href, cr);

    if (util.emptyObj(cr)) return noAnswer;

    const dnsBuffer = dnsutil.encode(cr.dnsPacket);
    // note: stamps in cr may be out-of-date; for ex, consider a
    // scenario where v6.example.com AAAA to fda3:: today,
    // but CNAMEs to v6.test.example.org tomorrow. cr.metadata
    // would contain stamps for [v6.example.com, example.com]
    // whereas it should be [v6.example.com, example.com
    // v6.test.example.org, test.example.org, example.org]
    const stamps = rdnsutil.blockstampFromCache(cr);
    const blockInfo = param.userBlocklistInfo;
    const res = rdnsutil.dnsResponse(cr.dnsPacket, dnsBuffer, stamps);

    await this.makeCacheResponse(rxid, /* out*/ res, blockInfo);

    if (res.isBlocked) return res;

    if (!cacheutil.isAnswerFresh(cr.metadata)) return noAnswer;

    return updatedAnswer(res, packet.id, cr.metadata.expiry);
  }

  async makeCacheResponse(rxid, r, blockInfo) {
    // check incoming dns request against blocklists in cache-metadata
    this.blocker.blockQuestion(rxid, /* out*/ r, blockInfo);
    this.log.d(rxid, blockInfo, "question blocked?", r.isBlocked);
    if (r.isBlocked) {
      return r;
    }

    // cache-response contains only query and not answers,
    // hence there are no more domains to block.
    if (!dnsutil.hasAnswers(r.dnsPacket)) {
      return r;
    }

    // check outgoing cached dns-packet against blocklists
    this.blocker.blockAnswer(rxid, /* out*/ r, blockInfo);
    this.log.d(rxid, "answer block?", r.isBlocked);

    return r;
  }
}

function updatedAnswer(r, qid, expiry) {
  cacheutil.updateQueryId(r.dnsPacket, qid);
  cacheutil.updateTtl(r.dnsPacket, expiry);

  const reencoded = dnsutil.encode(r.dnsPacket);

  return rdnsutil.dnsResponse(r.dnsPacket, reencoded, r.stamps);
}
