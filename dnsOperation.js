/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

var DNSParserWrap = require("./dnsParserWrap.js").DNSParserWrap
var DNSBlock = require("./dnsBlock.js").DNSBlock
var DNSCnameBlock = require("./dnsCnameBlock.js").DNSCnameBlock
var DNSResolver = require("./dnsResolver.js").DNSResolver

module.exports.DNSParserWrap = DNSParserWrap
module.exports.DNSBlock = DNSBlock
module.exports.DNSCnameBlock = DNSCnameBlock
module.exports.DNSResolver = DNSResolver