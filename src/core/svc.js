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
  DNSPrefilter,
  DNSCacheResponder,
  DNSResolver,
  DnsCache,
} from "../plugins/dns-op/dns-op.js";
import { LogPusher } from "../plugins/observability/log-pusher.js";
import * as dnsutil from "../commons/dnsutil.js";
import * as system from "../system.js";
import * as util from "../commons/util.js";

// proc up since
let readytime = 0;
let endtimer = null;
// unix timestamp of the latest recorded heartbeat
let latestHeartbeat = 0;

export const services = {
  /** @type {Boolean} ready */
  ready: false,
  /** @type {BlocklistWrapper?} blocklistWrapper */
  blocklistWrapper: null,
  /** @type {UserOp?} userOp */
  userOp: null,
  /** @type {DNSPrefilter?} prefilter */
  prefilter: null,
  /** @type {CommandControl?} commandControl */
  commandControl: null,
  /** @type {DNSCacheResponder?} dnsCacheHandler */
  dnsCacheHandler: null,
  /** @type {DNSResolver?} dnsResolver */
  dnsResolver: null,
  /** @type {LogPusher?} logPusher */
  logPusher: null,
};

((main) => {
  // On Workers, asynchronous I/O, timeouts, and generating random values,
  // can only be performed while handling a request.
  system.when("ready").then(systemReady);
  system.when("stop").then(systemStop);
})();

async function systemReady() {
  if (services.ready) return;

  log.i("svc", "systemReady");

  const bw = new BlocklistWrapper();
  const cache = new DnsCache(dnsutil.cacheSize());
  const lp = new LogPusher();

  services.blocklistWrapper = bw;
  services.logPusher = lp;
  services.userOp = new UserOp();
  services.prefilter = new DNSPrefilter();
  services.dnsCacheHandler = new DNSCacheResponder(bw, cache);
  services.dnsResolver = new DNSResolver(bw, cache);
  services.commandControl = new CommandControl(bw, services.dnsResolver, lp);

  services.ready = true;

  readytime = Date.now();

  system.pub("steady");
}

async function systemStop() {
  log.d("svc stop, signal close resolver");
  if (services.ready) await services.dnsResolver.close();
}

function stopProc() {
  log.i("stopping proc, times-up");
  system.pub("stop");
}

export function uptime() {
  return Date.now() - readytime;
}

export function stopAfter(ms = 0) {
  if (ms < 0) {
    log.w("invalid stopAfter", ms);
    return;
  } else {
    log.d("stopAfter", ms);
  }
  const now = Date.now();
  // 30% of the upcoming wait-time
  const p30 = (ms * 0.3) | 0;
  const when = now - latestHeartbeat;
  // was the previous heartbeat recent enough?
  const recent = when <= p30;
  // is the incoming wait (ms) 2x the pending wait?
  const pending = when - ms;
  const nearer = pending > 2 * ms;
  // if pending wait not too high and the prev heartbeat too recent
  if (!nearer && recent) {
    log.d("skip heartbeat; prev heartbeat was", when, "ms ago; lt", p30);
    return;
  }
  clearEndTimer();
  endtimer = util.timeout(ms, stopProc);
  log.d("n?", nearer, "r?", recent, "pending", pending, "extend ttl", ms);
  latestHeartbeat = now;
}

function clearEndTimer() {
  if (util.emptyObj(endtimer)) return false;
  clearTimeout(endtimer);
  return true;
}
