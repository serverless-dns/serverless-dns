/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as dnsutil from "../../commons/dnsutil.js";

export class BlocklistFilter {
  constructor() {
    // see: src/helpers/node/blocklists.js:hasBlocklistFiles
    this.ftrie = null;
    this.filetag = null;
  }

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
    return t.lookup(t.transform(n));
  }

  extract(ids) {
    const r = {};
    for (const id of ids) r[id] = this.filetag[id];
    return r;
  }
}
