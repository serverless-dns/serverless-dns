/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */




var Modules = []
Modules[0] = require('@serverless-dns/globalcontext').SharedContext
Modules[1] = require('@serverless-dns/command-control').CommandControl
Modules[2] = require('@serverless-dns/single-request').SingleRequest
Modules[3] = require("./UserOperation.js").UserOperation
Modules[4] = require('@serverless-dns/dns-blocker').DNSBlock
Modules[5] = require('@serverless-dns/dns-blocker').DNSResolver
Modules[6] = require('@serverless-dns/dns-blocker').DNSCnameBlock
Modules[7] =  require('./UserLog.js').Log
//Modules[8] =  require('@celzero/')
module.exports.Modules = Modules