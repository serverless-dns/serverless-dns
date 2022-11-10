/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import DNSResolver from "./resolver.js";
import { DNSPrefilter } from "./prefilter.js";
import { DNSCacheResponder } from "./cache-resolver.js";
import { DnsCache } from "./cache.js";

export { DNSResolver, DNSCacheResponder, DnsCache, DNSPrefilter };
