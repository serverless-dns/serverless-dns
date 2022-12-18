/*
 * Copyright (c) 2022 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as util from "../../commons/util.js";
import * as dnsutil from "../../commons/dnsutil.js";
import * as envutil from "../../commons/envutil.js";

const emptystring = "";
// csv separator length
const commalen = 1;
// logpush limits a single log msg to upto 150 chars
const charlimit = 150;

/**
 * There's no way to enable Logpush on just one Worker env or choose different
 * log sinks depending on script-name or environment or Worker name, for now.
 * This means, logs from serverless-dns (debug) are likely to end up in the same
 * sink as basic-unbound (prod).
 *
 * Logpush limits a single log msg to upto 150 chars, and total log msgs per
 * request to 20. Logpush does not support min batch size, or min batch time
 * (though, it supports max batch size and max batch time).
 *
 * By default, Logpush uploads traces of all uncaught exceptions. There's no way
 * to turn this off, except for filter on "outcome". We, however, log all errors
 * along with relevant DNS request logs, if requested (per user) and if enabled
 * (on the Cloudflare dashboard). And so, request logs are identified by the
 * presence of "k:<logkey>" csv in the log output.
 *
 * Refs:
 * developers.cloudflare.com/workers/platform/logpush
 * developers.cloudflare.com/logs/get-started/enable-destinations/r2
 * developers.cloudflare.com/api/operations/logpush-jobs-list-logpush-jobs
 * developers.cloudflare/logs/reference/log-fields/account/workers_trace_events
 */
export class LogPusher {
  constructor() {
    this.log = console.log;
    this.sources = envutil.logpushSources();
  }

  async RethinkModule(param) {
    let response = util.emptyResponse();

    if (this.noop(param)) {
      return response;
    }

    try {
      const request = param.request;
      const rxid = param.rxid;
      const lid = param.lid;
      const reg = param.region;
      // may be null if user hasn't set a custom upstream
      const upstream = param.userDnsResolverUrl || emptystring;
      // may not exist if not a dns query
      const query = param.requestDecodedDnsPacket || null;
      // may be missing in case of exceptions or blocked answers
      const ans = param.responseDecodedDnsPacket || null;
      // may be missing in case qname is not in any blocklist
      // note: blockflag is set regardless of whether the query is blocked
      const flag = param.blockflag || emptystring;
      this.logpush(rxid, lid, reg, request, upstream, query, ans, flag);
    } catch (e) {
      response = util.errResponse("dnsResolver", e);
      this.log.e(param.rxid, "main", e.stack);
    }

    return response;
  }

  logpush(rxid, lid, reg, req, upstream, q, a, flag) {
    // ex: k:1c34wels9yeq2
    const lk = this.key("k", lid);
    // ex: v:1
    const version = this.key("v", this.getversion());
    // ex: r:maa
    const region = this.key("r", reg);
    // ex: i:1.2.3.4
    const ip = this.key("i", this.getip(req));
    // ex: h:example.com
    const host = this.key("h", this.gethost(req));
    // ex: u:dns.google
    const up = this.key("u", this.getupstream(upstream));
    // ex: q:block.this.website
    const qname = this.key("q", this.getqname(q));
    // ex: t:A
    const qtype = this.key("t", this.getqtype(q));
    // ex: a:0.0.0.0
    const ans = this.key("a", this.getans(a));
    // ex: f:1:2AOAERQAkAQKAggAAEA
    const f = this.key("f", flag);

    const all = [version, ip, region, host, up, qname, qtype, ans, f];

    // max number of chars in a log entry
    const n = this.getlimit(lk.length);
    const lines = this.mklogs(all, n);

    // log-id, log-entry
    for (const l of lines) {
      // k:avc,0:cd9i01d9mw,v:1,q:rethinkdns.com,t:AAAA,a:2606:4700::81d4:fa9a
      this.log(lk + "," + l);
    }
  }

  getlimit(lklen) {
    return charlimit - (lklen + commalen);
  }

  getversion() {
    return "1";
  }

  getip(req) {
    return (
      req.headers.get("x-nile-client-ip") ||
      req.headers.get("cf-connecting-ip") ||
      emptystring
    );
  }

  gethost(req) {
    req.headers.get("host") || emptystring;
  }

  getupstream(upstream) {
    if (util.emptyString(upstream)) return emptystring;
    try {
      const u = new URL(upstream);
      return u.hostname;
    } catch (ignore) {}
    return emptystring;
  }

  getqname(q) {
    if (!q) return emptystring;
    if (util.emptyArray(q.questions)) return emptystring;
    return dnsutil.getQueryName(q.questions) || emptystring;
  }

  getqtype(q) {
    if (!q) return emptystring;
    return dnsutil.getQueryType(q) || emptystring;
  }

  getans(a) {
    if (!a) return emptystring;
    return dnsutil.getAnswerTarget(a) || emptystring;
  }

  // no-op when not a dns-msg or missing log-id or host is not a log-source
  noop(param) {
    if (!param.isDnsMsg) return true;
    if (util.emptyString(param.lid)) return true;
    if (util.emptySet(this.sources)) return true;

    const u = new URL(param.request.url);
    for (const s of this.sources) {
      if (u.hostname.indexOf(s) >= 0) return false;
    }
    return true;
  }

  key(k, v) {
    if (util.emptyString(v)) {
      return emptystring;
    }
    return `${k}:${v}`;
  }

  mklogs(all, limit = charlimit) {
    const lines = [];
    let line = "";
    for (let item of all) {
      if (util.emptyString(item)) continue;
      item = item.slice(0, limit);
      if (line.length + item.length > limit) {
        // remove trailing comma
        const t = line.slice(0, -1);
        lines.push(t);
        line = "";
      }
      line = line + item + ",";
    }
    if (!util.emptyString(line)) {
      // remove trailing comma
      const t = line.slice(0, -1);
      lines.push(t);
    }
    return lines;
  }
}
