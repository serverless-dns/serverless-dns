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
import * as txs from "../../commons/lf-transformer.js";
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
const charlimit = 300;
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

// min analytics interval minutes per query
const minmins = 1;
// one year in minutes
const maxmins = 365 * 24 * 60;
// min number of rows per query
const minlimit = 1;
// max number of rows per query
const maxlimit = 100;

// stream process logpush logs as text?
const processLogsAsText = false;

// note: no way to retrieve dataset names from the wa bindings
// datasets for worker analytics
const ONE_WA_DATASET1 = "ONE_M0";
const ONE_WA_DATASET2 = "ONE_BL0";

/**
 * Logpush limits a single log msg to upto 150 chars, and total log msgs per
 * request to 20. Logpush does not support min batch size, or min batch time
 * (though, it supports max batch size and max batch time).
 *
 * By default, Logpush uploads traces of all uncaught exceptions. There's no way
 * to turn this off, except for filter on "outcome". We, however, log all errors
 * along with relevant DNS request logs, if requested (per user) and if enabled
 * (on the Cloudflare dashboard). Request logs are identified by the
 * presence of "k:<logkey>" csv in the log output.
 *
 * For RethinkDNS, Logpush is enabled only on an env named "one" only.
 *
 * DNS query and answer analytics are pushed to Worker Analytics (wa), which
 * supports 20 strings + 20 floats in a single API call per dataset (table).
 * ServerlessDNS use two datasets, one for dns and one for blocklists.
 *
 * Refs:
 * developers.cloudflare.com/workers/platform/logpush
 * developers.cloudflare.com/logs/get-started/enable-destinations/r2
 * developers.cloudflare.com/api/operations/logpush-jobs-list-logpush-jobs
 * developers.cloudflare/logs/reference/log-fields/account/workers_trace_events
 * developers.cloudflare.com/analytics/analytics-engine
 */
export class LogPusher {
  constructor() {
    /** @type {GeoIP} */
    this.geoip = new GeoIP();
    this.corelog = log.withTags("LogPusher");
    /** @type Set<string> */
    this.sources = envutil.logpushSources();
    /** @type Map<String, String> */
    this.cols1 = this.setupCols1();
    /** @type URL | null */
    this.meturl = this.setupMetUrl();
    this.remotelogurl = this.setupLogpushUrl();
    /** @type String */
    this.apitoken = envutil.cfApiToken();

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

    // The cost of enabling cf logpush in prod:
    //        |   cpu                |   gb-sec
    // %      |   before     after   |   before     after
    // p99.9  |   60.7       80      |   0.2        0.2
    // p99    |   22.2       35      |   0.05       0.05
    // p75    |   3.6        4.4     |   0.004      0.005
    // p50    |   2.2        2.6     |   0.002      0.003
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

    bg(this.rec(lid, all));

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
  async rec(lid, all) {
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

    // lk is simply "logkey" and not "k:logkey"
    const idx1 = this.idxmet(lid, "1");
    const idx2 = this.idxmet(lid, "2");

    // metric blobs in m1 should never change order; add new blobs at the end
    // update this.setupCols1() when appending new blobs / doubles
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
      indexes: [idx1],
    });
    if (metrics2.length > 0) {
      m2.writeDataPoint({
        blobs: blobs2.map((m) => m.blob),
        doubles: doubles2.map((m) => m.double),
        indexes: [idx2],
      });
    }
    this.corelog.d(`rec: ${lid} ${blobs1.length} ${doubles1.length}`);
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

  idxmet(lk, n) {
    return `${lk}${n}`;
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

  setupCols1() {
    const cols = new Map();
    cols.set("ip", "blob1");
    cols.set("qname", "blob2");
    cols.set("region", "blob3");
    cols.set("qtype", "blob4");
    cols.set("dom", "blob5");
    cols.set("ansip", "blob6");
    cols.set("cc", "blob7");
    cols.set("req", "double1");
    cols.set("blocked", "double2");
    return cols;
  }

  setupMetUrl() {
    // "https://api.cloudflare.com/client/v4/accounts/$ACC_ID/analytics_engine/sql"
    // -H "Authorization: Bearer $API_TOKEN"
    const accid = envutil.cfAccountId();

    if (util.emptyString(accid)) return null;

    return new URL(
      `https://api.cloudflare.com/client/v4/accounts/${accid}/analytics_engine/sql`
    );
  }

  setupLogpushUrl() {
    // https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/logs/retrieve
    // start=2022-06-01T16:00:00Z
    // end=2022-06-01T16:05:00Z
    // bucket=cloudflare-logs
    // prefix=http_requests/example.com/{DATE}
    const accid = envutil.cfAccountId();
    // ex: bucket/dir1/dir2
    const logpath = envutil.logpushPath();
    const p = logpath.indexOf("/");

    if (util.emptyString(accid)) return null;
    if (p < 0) return null;

    const date = "{DATE}";
    const now = new Date();
    const end = now.toISOString();
    now.setHours(now.getHours() - 3);
    const start = now.toISOString();
    // ex: bucket
    const bucket = logpath.slice(0, p);
    // ex: dir1/dir2
    let rest = logpath.slice(p + 1);
    if (!util.emptyString(rest)) {
      rest = rest.endsWith("/") ? rest : `${rest}/`;
    }
    const prefix = rest ? `${rest}${date}` : `${date}`;

    const u = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${accid}/logs/retrieve`
    );
    u.searchParams.set("bucket", bucket);
    u.searchParams.set("prefix", prefix);
    u.searchParams.set("start", start);
    u.searchParams.set("end", end);

    return u;
  }

  // developers.cloudflare.com/analytics/analytics-engine/sql-reference
  /**
   * Return total count grouped by field
   * @param {string} index
   * @param {number} mins
   * @param {string} fields
   * @param {number} limit
   * @returns {Promise<Response>}
   */
  async count1(lid, fields, mins = 30, dataset = ONE_WA_DATASET1, limit = 10) {
    const idx1 = this.idxmet(lid, "1");
    const f0 = fields[0];
    const col = this.cols1.get(f0);
    const vol = this.cols1.get("req");
    mins = util.bounds(mins || 30, minmins, maxmins);
    dataset = dataset || ONE_WA_DATASET1;
    limit = util.bounds(limit || 10, minlimit, maxlimit);
    const sql = `
      SELECT
        ${col} as ${f0},
        SUM(_sample_interval * ${vol}) as n
      FROM ${dataset}
      WHERE index1 = '${idx1}'
        AND timestamp > NOW() - INTERVAL '${mins}' MINUTE
      GROUP BY ${f0}
      ORDER BY n DESC
      LIMIT ${limit}
      `;
    return this.query(sql);
  }

  async query(sql) {
    if (this.meturl == null) return null;
    if (util.emptyString(this.apitoken)) return null;
    if (util.emptyString(sql)) return null;

    this.corelog.d(`querying: ${sql}`);
    return await fetch(this.meturl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apitoken}`,
      },
      body: sql,
    });
  }

  // developers.cloudflare.com/logs/r2-log-retrieval
  /**
   *
   * @param {string} lid
   * @param {string|Date|number} start
   * @param {string|Date|number} end
   * @returns {Promise<ReadableStream<String>> | Promise<ReadableStream<Uint8Array>> | Promise<null>}
   */
  async remotelogs(lid, start, end) {
    const ak = envutil.logpushAccessKey();
    const sk = envutil.logpushSecretKey();

    if (this.remotelogurl == null) return null;
    if (util.emptyString(this.apitoken)) return null;
    if (util.emptyString(ak)) return null;
    if (util.emptyString(sk)) return null;

    // copy
    const u = new URL(this.remotelogurl);
    if (start && end) {
      start = new Date(start);
      end = new Date(end);
      if (start.getTime() > end.getTime()) {
        const t = start;
        start = end;
        end = t;
      }
      u.searchParams.set("start", start.toISOString());
      u.searchParams.set("end", end.toISOString());
    }

    this.corelog.d(`remotelogs: ${u}`);

    /*
     * { "EventTimestampMs": 1672678731630,
     *   "Outcome": "ok",
     *   "Logs": [
     *      { "Level": "log",
     *        "Message": [
     *           "k:lid,v:1,i:14.1.1.2,r:BOM,u:,q:c.rome.api,t:A,a:163.1.1.2|c.api.net,f:"
     *        ],
     *       "TimestampMs": 1672678731630
     *      }
     *   ],
     *   "ScriptName": "dns-one"
     * }
     */
    const r = await fetch(u, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${this.apitoken}`,
        "R2-Access-Key-Id": ak,
        "R2-Secret-Access-Key": sk,
      },
    });

    if (r.ok) {
      return this.filterlog(r.body, lid);
    }

    return r.body;
  }

  /**
   *
   * @param {ReadableStream<Uint8Array>|null} body
   * @param {string} filterstr
   * @returns {ReadableStream<String>|null}
   */
  filterlog(body, filterstr) {
    if (body == null) return null;
    if (processLogsAsText) {
      return (
        body
          // note: DecompressionStream needs at least node 17
          // gzip? pipeThrough(new DecompressionStream("gzip"))
          .pipeThrough(new TextDecoderStream())
          .pipeThrough(txs.strstream(filterstr))
          .pipeThrough(new TextEncoderStream())
      );
    } else {
      return body.pipeThrough(txs.bufstream(filterstr));
    }
  }
}
