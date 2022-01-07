/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
// TODO: break-up cache-wrapper
// move domain-name-cache to blocklist-wrapper
// move user-cache to basic
// move dns-cache to core
import { UserCache } from "./userCache.js";
import { DomainNameCache } from "./domainNameCache.js";
import { DnsCache } from "./dnsCache.js";

export { DnsCache, DomainNameCache, UserCache };
