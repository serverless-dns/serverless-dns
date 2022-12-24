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
import * as pres from "../plugin-response.js";
import * as rdnsutil from "../rdns-util.js";
import { GeoIP } from "./geoip.js";

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
    /** @type {GeoIP} */
    this.geoip = new GeoIP();
    this.corelog = log.withTags("LogPusher");
    this.sources = envutil.logpushSources();

    // debug settings
    this.stubmetrics = false;
    this.stubremotelog = false;

    this.remotelog = this.stubremotelog ? util.stub : console.log;

    this.corelog.d("stub met? rlog?", this.stubmetrics, this.stubremotelog);
  }

  async init(g4, g6) {
    return this.geoip.init(g4, g6);
  }

  initDone() {
    return this.geoip.initDone();
  }

  geo4() {
    return this.geoip.geo4;
  }

  geo6() {
    return this.geoip.geo6;
  }

  /**
   * @param {any} ctx
   * @returns {Promise<pres.RResp>}
   */
  async exec(ctx) {
    let response = pres.emptyResponse();

    if (this.noop(ctx)) {
      return response;
    }

    try {
      const request = ctx.request;
      const bg = ctx.dispatcher;
      const rxid = ctx.rxid;
      const lid = ctx.lid;
      const reg = ctx.region;
      // may be null if user hasn't set a custom upstream
      const upstream = ctx.userDnsResolverUrl || emptystring;
      // may not exist if not a dns query
      const query = ctx.requestDecodedDnsPacket || null;
      // may be missing in case of exceptions or blocked answers
      const ans = ctx.responseDecodedDnsPacket || null;
      // may be missing in case qname is not in any blocklist
      // note: blockflag is set regardless of whether the query is blocked
      const flag = ctx.blockflag || emptystring;

      this.logpush(rxid, bg, lid, reg, request, upstream, query, ans, flag);
    } catch (e) {
      response = pres.errResponse("logpusher", e);
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

  getipfromans(delimitedans) {
    if (util.emptyString(delimitedans)) return emptystring;
    const v = this.valOf(delimitedans);
    for (const a of v.split(ansdelim)) {
      if (util.maybeIP(a)) return a;
    }
    return emptystring;
  }

  metricsservice() {
    let m1 = null;
    let m2 = null;
    if (this.stubmetrics) {
      m1 = { writeDataPoint: util.stub };
      m2 = { writeDataPoint: util.stub };
    } else {
      [m1, m2] = envutil.metrics();
    }
    return [m1, m2];
  }

  async getcountry(ipstr) {
    if (util.emptyString(ipstr)) return emptystring;
    await this.init();
    return this.geoip.country(ipstr);
  }

  // no-op when not a dns-msg or missing log-id or host is not a log-source
  noop(ctx) {
    const y = true;
    const n = false;
    if (!ctx.isDnsMsg) return y;
    if (util.emptyString(ctx.lid)) return y;

    // if empty, allow all hosts / sources
    if (util.emptySet(this.sources)) return n;

    const u = new URL(ctx.request.url);
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
  async rec(lk, all) {
    const [m1, m2] = this.metricsservice();
    if (m1 == null || m2 == null) return;

    const metrics1 = [];
    const metrics2 = [];
    const [version, ip, region, up, qname, qtype, ans, f] = all;

    // ans is a multi-value str delimited by pipe
    const isblocked = this.isansblocked(qtype, ans, f);
    const blists = this.getblocklists(f);
    const dom = this.getdomain(qname);
    const ansip = this.getipfromans(ans);
    const countrycode = await this.getcountry(ansip);
    // todo: device-id, should it be concatenated with log-key?
    // todo: faang dominance (sigma?)

    // metric blobs in m1 should never change order; add new blobs at the end
    metrics1.push(this.strmet(ip)); // ip hits
    metrics1.push(this.strmet(qname)); // query count
    metrics1.push(this.strmet(region)); // total requests
    metrics1.push(this.strmet(qtype)); // query type count
    metrics1.push(this.strmet(dom)); // domain count
    metrics1.push(this.strmet(ansip)); // ip count
    metrics1.push(this.strmet(countrycode)); // geo ip count

    // metric numbers in m1 should never change order; add new numbers at the end
    metrics1.push(this.nummet(1.0)); // req count
    metrics1.push(this.nummet(isblocked ? 1.0 : 0.0)); // blocked count

    if (isblocked) {
      // metric blobs in m2 can have variable order
      for (const b of blists) {
        if (metrics2.length > maxdatapoints) break;
        const kb = this.key("l", b);
        metrics2.push(this.strmet(kb)); // blocklist
      }
      metrics2.push(this.nummet(blists.length)); // blocklists count
    }

    this.corelog.d(`rec: ${lk} ${metrics1.length} ${metrics2.length}`);
    const blobs1 = metrics1.filter((m) => m.blob != null);
    const blobs2 = metrics2.filter((m) => m.blob != null);
    const doubles1 = metrics1.filter((m) => m.double != null);
    const doubles2 = metrics2.filter((m) => m.double != null);
    // developers.cloudflare.com/analytics/analytics-engine/get-started
    // indexes are limited to 32 bytes, blobs are limited to 5120 bytes
    // there can be a maximum of 1 index and 20 blobs, per data point
    // per cf discord, needn't await / waitUntil as writeDataPoint is
    // a non-blocking call that returns void (like console.log)
    m1.writeDataPoint({
      blobs: blobs1.map((m) => m.blob),
      doubles: doubles1.map((m) => m.double),
      indexes: [lk],
    });
    if (metrics2.length > 0) {
      m2.writeDataPoint({
        blobs: blobs2.map((m) => m.blob),
        doubles: doubles2.map((m) => m.double),
        indexes: [lk],
      });
    }
  }

  // d is a domain name like "x.y.z.tld"
  getdomain(d) {
    return util.tld(d);
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

  strmet(k = "none") {
    return {
      blob: k,
      double: null,
    };
  }

  nummet(v = 0) {
    return {
      blob: null,
      double: v,
    };
  }
}
