/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { FrozenTrie } from "@serverless-dns/trie/ftrie.js";
import * as dnsutil from "../../commons/dnsutil.js";
import { log } from "../../core/log.js";

export class BlocklistFilter {
  constructor() {
    // see: src/helpers/node/blocklists.js:hasBlocklistFiles
    /** @type {FrozenTrie} */
    this.ftrie = null;
    /** @type {Object} */
    this.filetag = null;
  }

  /**
   * @param {FrozenTrie} frozentrie
   * @param {Object} filetag
   */
  load(frozentrie, filetag) {
    this.ftrie = frozentrie;
    this.filetag = filetag;
  }

  blockstamp(domainName) {
    const n = dnsutil.normalizeName(domainName);

    return this.lookup(n);
  }

  lookup(n) {
    const t = this.ftrie;
    if (t == null) {
      log.w("blocklist filter not loaded");
      return null;
    }

    try {
      n = t.transform(n);
      return t.lookup(n);
    } catch (ignored) {
      // usually u8 / u6 uencode error
      /*
       * E DnsResolver [rx.0n550a6jz.dcgr3go4md] main Error:
       * encode: undef num: undefined, for: :,
       * in: https://app-measurement.com/sdk-exp, res: 22,34,34,
       * 30,33,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
       * at Codec.encodeinner (file:///app/fly.mjs:9362:15)
       * at Codec.encode (file:///app/fly.mjs:9325:24)
       * at FrozenTrie.transform (file:///app/fly.mjs:10443:23)
       * at BlocklistFilter.lookup (file:///app/fly.mjs:10633:23)
       * at BlocklistFilter.blockstamp (file:///app/fly.mjs:10628:17)
       * at Object.blockstampFromBlocklistFilter (file:///app/fly.mjs:14692:35)
       * at DNSResolver.makeRdnsResponse (file:///app/fly.mjs:11737:54)
       * at DNSResolver.resolveDns (file:///app/fly.mjs:11618:26)
       * at DNSResolver.exec (file:///app/fly.mjs:11536:34)
       */
      log.d("blf lookup err:", ignored.message);
    }
    return null;
  }

  extract(ids) {
    const r = {};
    if (this.filetag) {
      for (const id of ids) r[id] = this.filetag[id];
    }
    return r;
  }
}
