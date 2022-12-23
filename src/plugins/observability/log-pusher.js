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
import * as rdnsutil from "../rdns-util.js";

const emptyarr = [];
const emptystring = "";
// current logpush version
const ver = "1";
// csv separator length
const commalen = 1;
// logpush limits a single log msg to upto 150 chars
const charlimit = 150;
// max number of datapoints per metric write
const maxdatapoints = 20;
// max answer data length (in chars)
const maxansdatalen = 80;
// delimiter for answer data
const ansdelim = "|";
// kv separator for log data
const logsep = ":";
// delimiter for log data
const logdelim = ",";

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
    this.remotelog = console.log;
    this.corelog = log.withTags("LogPusher");
    this.sources = envutil.logpushSources();
  }

  async RethinkModule(param) {
    let response = util.emptyResponse();

    if (this.noop(param)) {
      return response;
    }

    try {
      const request = param.request;
      const bg = param.dispatcher;
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

      this.logpush(rxid, bg, lid, reg, request, upstream, query, ans, flag);
    } catch (e) {
      response = util.errResponse("logpusher", e);
    }

    return response;
  }

  logpush(rxid, bg, lid, reg, req, upstream, q, a, flag) {
    // ex: k:1c34wels9yeq2
    const lk = this.key("k", lid);
    // ex: v:1
    const version = this.key("v", this.getversion());
    // ex: r:maa
    const region = this.key("r", reg);
    // ex: i:1.2.3.4
    const ip = this.key("i", this.getip(req));
    // ex: u:dns.google
    const up = this.key("u", this.getupstream(upstream));
    // ex: q:block.this.website
    const qname = this.key("q", this.getqname(q));
    // ex: t:A
    const qtype = this.key("t", this.getqtype(q));
    // ex: a:0.0.0.0 or a:NXDOMAIN or a:<base64> or a:ip1|ip2|cname
    const ans = this.key("a", this.getans(a));
    // ex: f:1:2AOAERQAkAQKAggAAEA
    const f = this.key("f", flag);
    const all = [version, ip, region, up, qname, qtype, ans, f];

    // max number of chars in a log entry
    const n = this.getlimit(lk.length);
    const lines = this.mklogs(all, n);
    // log-id, log-entry
    for (const l of lines) {
      // k:avc,0:cd9i01d9mw,v:1,q:rethinkdns.com,t:AAAA,a:2606:4700::81d4:fa9a
      this.remotelog(lk + logdelim + l);
    }

    bg(this.rec(lk, all));

    this.corelog.d(`remotelog lines: ${lk} ${lines.length}`);
  }

  getlimit(lklen) {
    return charlimit - (lklen + commalen);
  }

  getversion() {
    return ver;
  }

  getip(req) {
    return (
      req.headers.get("x-nile-client-ip") ||
      req.headers.get("cf-connecting-ip") ||
      emptystring
    );
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
    return dnsutil.getInterestingAnswerData(a, maxansdatalen, ansdelim);
  }

  // no-op when not a dns-msg or missing log-id or host is not a log-source
  noop(param) {
    const y = true;
    const n = false;
    if (!param.isDnsMsg) return y;
    if (util.emptyString(param.lid)) return y;

    // if empty, allow all hosts / sources
    if (util.emptySet(this.sources)) return n;

    const u = new URL(param.request.url);
    for (const s of this.sources) {
      if (u.hostname.indexOf(s) >= 0) return n;
    }

    return y;
  }

  key(k, v) {
    if (util.emptyString(v)) {
      return `${k}${logsep}`;
    }
    return `${k}${logsep}${v}`;
  }

  valOf(kv) {
    const kidx = kv.indexOf(logsep);
    if (kidx < 0) return emptystring;
    return util.strstr(kv, kidx + 1);
  }

  mklogs(all, limit = charlimit) {
    const lines = [];
    let csv = "";
    for (let item of all) {
      if (util.emptyString(item)) continue;
      // if item is too long, truncate it
      item = item.slice(0, limit);
      // if item too long, plonk it in the next line
      if (csv.length + item.length > limit) {
        // remove trailing comma
        const t = csv.slice(0, -1);
        // commit csv line
        lines.push(t);
        // reset for next line
        csv = "";
      }
      // add item to line as csv
      csv = csv + item + ",";
    }
    if (!util.emptyString(csv)) {
      // remove trailing comma
      const t = csv.slice(0, -1);
      lines.push(t);
    }
    return lines;
  }

  // all => [version, ip, region, host, up, qname, qtype, ans, f]
  rec(lk, all) {
    const [m1, m2] = envutil.metrics();
    if (m1 == null || m2 == null) return;

    const metrics1 = [];
    const metrics2 = [];
    const [version, ip, region, up, qname, qtype, ans, f] = all;

    const reqcount = this.key("n", "req");
    const blockedcount = this.key("n", "blocked");
    // ans is a multi-value str delimited by pipe
    const isblocked = this.isansblocked(qtype, ans, f);
    const blists = this.getblocklists(f);
    const dom = this.getdomain(qname);
    // todo: device-id, should it be concatenated with log-key?
    // todo: faang dominance (sigma?)
    // todo: geo-ip

    // metric blobs in m1 should never change order; add new blobs at the end
    metrics1.push(this.met(reqcount, 1.0));
    metrics1.push(this.met(blockedcount, isblocked ? 1.0 : 0.0));
    metrics1.push(this.met(ip, 1.0)); // ip hits
    metrics1.push(this.met(qname, 1.0)); // query count
    metrics1.push(this.met(region, 1.0)); // total requests
    metrics1.push(this.met(qtype, 1.0)); // query type count
    metrics1.push(this.met(dom, 1.0)); // domain count

    if (isblocked) {
      // metric blobs in m2 can have variable order
      for (const b of blists) {
        if (metrics2.length > maxdatapoints) break;
        const kb = this.key("l", b);
        metrics2.push(this.met(kb, 1.0));
      }
    }

    this.corelog.d(`rec: ${lk} ${metrics1.length} ${metrics2.length}`);
    // developers.cloudflare.com/analytics/analytics-engine/get-started
    // indexes are limited to 32 bytes, blobs are limited to 5120 bytes
    // there can be a maximum of 1 index and 20 blobs, per data point
    // per cf discord, needn't await / waitUntil as writeDataPoint is
    // a non-blocking call that returns void (like console.log)
    m1.writeDataPoint({
      blobs: metrics1.map((m) => m.blob),
      doubles: metrics1.map((m) => m.double),
      indexes: [lk],
    });
    if (metrics2.length > 0) {
      m2.writeDataPoint({
        blobs: metrics2.map((m) => m.blob),
        doubles: metrics2.map((m) => m.double),
        indexes: [lk],
      });
    }
  }

  // d is a domain name like "x.y.z.tld"
  getdomain(d) {
    if (util.emptyString(d)) return emptystring;
    const parts = d.split(".");
    if (parts.length < 2) return emptystring;
    // this simple logic is good enough for now
    // todo: fails for domains like "gov.uk", "co.in" etc
    // see: publicsuffix.org/list/public_suffix_list.dat
    return parts.slice(-2).join(".");
  }

  // flag is of the form f:1:2AOAERQAkAQKAggAAEA
  getblocklists(flag) {
    flag = this.valOf(flag);
    if (util.emptyString(flag)) return emptyarr;
    return rdnsutil.blocklists(flag);
  }

  // ansips is a multi-value str delimited by pipe
  isansblocked(qtype, ansips, flag) {
    qtype = this.valOf(qtype);
    ansips = this.valOf(ansips);
    flag = this.valOf(flag);
    // empty(answer) => blocked, iff flag is not empty
    if (!util.emptyString(flag)) {
      return util.emptyString(ansips);
    }
    // for qtypes that don't answer in ips, empty(answer) => blocked
    if (!dnsutil.queryTypeMayResultInIP(qtype)) {
      return util.emptyString(ansips);
    }
    // when query is blocked, there's only one ansip in ansips
    for (const ansip of ansips.split(ansdelim)) {
      if (dnsutil.isIPGrounded(ansip)) return true;
    }
    return false;
  }

  met(k, v = 0) {
    if (util.emptyString(k)) return {};
    return {
      blob: k,
      double: v,
    };
  }
}
