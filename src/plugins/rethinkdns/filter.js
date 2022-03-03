/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { customTagToFlag } from "./trie.js";
import * as dnsutil from "../../commons/dnsutil.js";
import * as rdnsutil from "../rdns-util.js";

export class BlocklistFilter {
  constructor() {
    // see: src/helpers/node/blocklists.js:hasBlocklistFiles
    this.t = null;
    this.ft = null;
    this.blocklistBasicConfig = null;
    this.blocklistFileTag = null;
    this.enc = new TextEncoder();
  }

  load(t, ft, blocklistBasicConfig, blocklistFileTag) {
    this.t = t;
    this.ft = ft;
    this.blocklistBasicConfig = blocklistBasicConfig;
    this.blocklistFileTag = blocklistFileTag;
  }

  blockstamp(domainName) {
    const n = dnsutil.normalizeName(domainName);

    return this.lookup(n);
  }

  lookup(n) {
    return this.ft.lookup(this.reverseUtf8(n));
  }

  reverseUtf8(s) {
    return this.enc.encode(s).reverse();
  }

  getTag(uintFlag) {
    return this.t.flagsToTag(uintFlag);
  }

  getB64FlagFromTag(tagList, flagVersion) {
    const uintFlag = customTagToFlag(tagList, this.blocklistFileTag);
    return rdnsutil.getB64Flag(uintFlag, flagVersion);
  }
}
