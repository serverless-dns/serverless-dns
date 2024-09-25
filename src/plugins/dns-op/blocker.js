/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as pres from "../plugin-response.js";
import * as rdnsutil from "../rdns-util.js";
import * as dnsutil from "../../commons/dnsutil.js";

export class DnsBlocker {
  constructor() {
    this.log = log.withTags("DnsBlocker");
  }

  /**
   * @param {string} rxid
   * @param {pres.RespData} req
   * @param {pres.BlockstampInfo} blockInfo
   * @returns {pres.RespData}
   */
  blockQuestion(rxid, req, blockInfo) {
    const dnsPacket = req.dnsPacket;
    const stamps = req.stamps;

    if (!stamps) {
      this.log.d(rxid, "q: no stamp");
      return req;
    }

    if (!rdnsutil.hasBlockstamp(blockInfo)) {
      this.log.d(rxid, "q: no user-set blockstamp");
      return req;
    }

    if (!dnsutil.isQueryBlockable(dnsPacket)) {
      this.log.d(rxid, "not a blockable dns-query");
      return req;
    }

    const domains = dnsutil.extractDomains(dnsPacket);
    const bres = this.block(domains, blockInfo, stamps);

    return pres.copyOnlyBlockProperties(req, bres);
  }

  /**
   * @param {string} rxid
   * @param {pres.RespData} res
   * @param {pres.BlockstampInfo} blockInfo
   * @returns {pres.RespData}
   */
  blockAnswer(rxid, res, blockInfo) {
    const dnsPacket = res.dnsPacket;
    const stamps = res.stamps;

    // dnsPacket is null when cache only has metadata
    if (!stamps || !dnsutil.hasAnswers(dnsPacket)) {
      this.log.d(rxid, "ans: no stamp / dns-packet");
      return res;
    }

    if (!rdnsutil.hasBlockstamp(blockInfo)) {
      this.log.d(rxid, "ans: no user-set blockstamp");
      return res;
    }

    if (!dnsutil.isAnswerBlockable(dnsPacket)) {
      this.log.d(rxid, "ans not cloaked with cname/https/svcb");
      return res;
    }

    if (dnsutil.isAnswerQuad0(dnsPacket)) {
      this.log.d(rxid, "ans: already blocked");
      return res;
    }

    const domains = dnsutil.extractDomains(dnsPacket);
    const bres = this.block(domains, blockInfo, stamps);

    return pres.copyOnlyBlockProperties(res, bres);
  }

  /**
   * @param {string[]} names
   * @param {pres.BlockstampInfo} blockInfo
   * @param {pres.BStamp} blockstamps
   * @returns {pres.RespData}
   */
  block(names, blockInfo, blockstamps) {
    let r = pres.rdnsNoBlockResponse();
    for (const n of names) {
      r = rdnsutil.doBlock(n, blockInfo, blockstamps);
      if (r.isBlocked) break;
    }
    return r;
  }
}
