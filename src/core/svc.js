/*
 * Copyright (c) 2022 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { BlocklistWrapper } from "../plugins/blocklist-wrapper/main.js";
import { CommandControl } from "../plugins/command-control/cc.js";
import { UserOperation } from "../plugins/basic/basic.js";
import {
  DNSCacheResponse,
  DNSQuestionBlock,
  DNSResolver,
  DNSResponseBlock,
} from "../plugins/dns-operation/dnsOperation.js";
import { DnsCache } from "../plugins/cache-wrapper/cache-wrapper.js";
import * as dnsutil from "../commons/dnsutil.js";
import * as envutil from "../commons/envutil.js";
import * as system from "../system.js";

export const services = {
  ready: false,
};

((main) => {
  system.sub("ready", systemReady);
})();

async function systemReady() {
  if (services.ready) return;

  log.i("plugins: systemReady");

  services.blocklistWrapper = new BlocklistWrapper();
  services.commandControl = new CommandControl();
  services.userOperation = new UserOperation();
  services.dnsQuestionBlock = new DNSQuestionBlock();
  services.dnsResolver = new DNSResolver();
  services.dnsResponseBlock = new DNSResponseBlock();
  services.dnsCacheHandler = new DNSCacheResponse();
  services.dnsCache = new DnsCache(dnsutil.cacheSize());

  if (envutil.isNode()) {
    const blocklists = await import("./node/blocklists.js");
    await blocklists.setup(services.blocklistWrapper);
  }

  services.ready = true;

  system.pub("go");
}
