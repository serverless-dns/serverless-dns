/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { DomainNameCache } from "../cache-wrapper/cache-wrapper.js";
import { customTagToFlag as _customTagToFlag } from "./radixTrie.js";
import * as dnsutil from "../helpers/dnsutil.js";
import * as dnsBlockUtil from "../helpers/dnsblockutil.js";

export class BlocklistFilter {
  constructor() {
    // see: src/helpers/node/blocklists.js:hasBlocklistFiles
    this.t = null;
    this.ft = null;
    this.blocklistBasicConfig = null;
    this.blocklistFileTag = null;
    this.domainNameCache = null;
    this.enc = new TextEncoder();
  }

  loadFilter(t, ft, blocklistBasicConfig, blocklistFileTag) {
    this.t = t;
    this.ft = ft;
    this.blocklistBasicConfig = blocklistBasicConfig;
    this.blocklistFileTag = blocklistFileTag;
    this.domainNameCache = new DomainNameCache(dnsutil.cacheSize());
  }

  getDomainInfo(domainName) {
    domainName = dnsutil.normalizeName(domainName);

    let domainNameInfo = this.domainNameCache.get(domainName);
    if (!domainNameInfo) {
      domainNameInfo = {
        searchResult: this.hadDomainName(domainName),
      };
      this.domainNameCache.put(domainName, domainNameInfo);
    }

    return domainNameInfo;
  }

  hadDomainName(n) {
    return this.ft.lookup(this.reverseUtf8(n));
  }

  reverseUtf8(s) {
    return this.enc.encode(s).reverse();
  }

  getTag(uintFlag) {
    return this.t.flagsToTag(uintFlag);
  }

  customTagToFlag(tagList) {
    return _customTagToFlag(tagList, this.blocklistFileTag);
  }

  getB64FlagFromTag(tagList, flagVersion) {
    const uintFlag = this.customTagToFlag(tagList);
    return dnsBlockUtil.getB64Flag(uintFlag, flagVersion);
  }
}
