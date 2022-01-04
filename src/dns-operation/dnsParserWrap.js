/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as DnsParser from "@serverless-dns/dns-parser";
import * as util from "../helpers/util.js";

export default class DNSParserWrap {
  constructor() {}

  decode(arrayBuffer) {
    return DnsParser.decode(util.bufferOf(arrayBuffer));
  }

  encode(decodedDnsPacket) {
    return DnsParser.encode(decodedDnsPacket);
  }
}
