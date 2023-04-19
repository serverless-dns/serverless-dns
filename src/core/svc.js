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
// last recorded wait-time, elasping which, endtimer goes off
let latestWaitMs = 0;

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
  // 33% of the upcoming wait-time
  const p50 = (ms * 0.3) | 0;
  const when = now - latestHeartbeat;
  // was the previous heartbeat recent enough?
  const recent = when <= p50;
  // was the previous wait 2x the current wait?
  const toohigh = latestWaitMs > 2 * ms;
  // if the current wait isn't too high, and
  // if the last heartbeat was too recent
  if (!toohigh && recent) {
    log.d("skip heartbeat; prev heartbeat was", when, "ms ago; lt", p50);
    return;
  }
  clearEndTimer();
  if (ms <= 0) {
    stopProc();
  } else {
    endtimer = util.timeout(ms, stopProc);
  }
  log.d("h?", toohigh, "r?", recent, "waitMs", latestWaitMs, "extend ttl", ms);
  latestWaitMs = ms;
  latestHeartbeat = now;
}

function clearEndTimer() {
  if (util.emptyObj(endtimer)) return false;
  clearTimeout(endtimer);
  return true;
}
