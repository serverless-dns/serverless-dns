/*
 * Copyright (c) 2022 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { BlocklistWrapper } from "../plugins/rethinkdns/main.js";
import { CommandControl } from "../plugins/command-control/cc.js";
import { UserOp } from "../plugins/users/user-op.js";
import {
  DNSCacheResponder,
  DNSResolver,
  DnsCache,
} from "../plugins/dns-op/dns-op.js";
import * as dnsutil from "../commons/dnsutil.js";
import * as system from "../system.js";

export const services = {
  /**
   * @type {Boolean} ready
   */
  ready: false,
  /**
   * @type {?BlocklistWrapper} blocklistWrapper
   */
  blocklistWrapper: null,
  /**
   * @type {?UserOp} userOp
   */
  userOp: null,
  /**
   * @type {?CommandControl} commandControl
   */
  commandControl: null,
  /**
   * @type {?DNSCacheResponder} dnsCacheHandler
   */
  dnsCacheHandler: null,
  /**
   * @type {?DNSResolver} dnsResolver
   */
  dnsResolver: null,
};

((main) => {
  // On Workers, asynchronous I/O, timeouts, and generating random values,
  // can only be performed while handling a request.
  system.when("ready").then(systemReady);
})();

async function systemReady() {
  if (services.ready) return;

  log.i("svc", "systemReady");

  const bw = new BlocklistWrapper();
  const cache = new DnsCache(dnsutil.cacheSize());

  services.blocklistWrapper = bw;
  services.userOp = new UserOp();
  services.dnsCacheHandler = new DNSCacheResponder(bw, cache);
  services.commandControl = new CommandControl(bw);
  services.dnsResolver = new DNSResolver(bw, cache);

  services.ready = true;

  system.pub("steady");
}
