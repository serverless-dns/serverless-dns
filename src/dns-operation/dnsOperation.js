/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import DNSParserWrap from "./dnsParserWrap.js";
import DNSQuestionBlock from "./dnsBlock.js";
import DNSResponseBlock from "./dnsResponseBlock.js";
import DNSResolver from "./dnsResolver.js";
import DNSCacheResponse from "./cacheResponse.js";

export {
  DNSQuestionBlock,
  DNSParserWrap,
  DNSResolver,
  DNSResponseBlock,
  DNSCacheResponse,
};
