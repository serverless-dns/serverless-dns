/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { DNSParserWrap as Dns } from "../dns-operation/dnsOperation.js";

const dns = new Dns();

export const servfail = dns.Encode({
  type: "response",
  flags: 4098, // sets serv-fail flag
});

