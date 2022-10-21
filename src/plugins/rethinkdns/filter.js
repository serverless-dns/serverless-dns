/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as dnsutil from "../../commons/dnsutil.js";
import { transform } from "@serverless-dns/trie";

export class BlocklistFilter {
  constructor() {
    // see: src/helpers/node/blocklists.js:hasBlocklistFiles
    this.ftrie = null;
    this.basicconfig = null;
    this.filetag = null;
  }

  load(ft, bconfig, filetag) {
    this.ftrie = ft;
    this.basicconfig = bconfig;
    this.filetag = filetag;
  }

  blockstamp(domainName) {
    const n = dnsutil.normalizeName(domainName);

    return this.lookup(n);
  }

  lookup(n) {
    return this.ftrie.lookup(transform(n));
  }

  extract(ids) {
    const r = {};
    for (const id of ids) r[id] = this.filetag[id];
    return r;
  }
}
