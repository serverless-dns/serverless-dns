/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { createTrie } from "@serverless-dns/trie/ftrie.js";
import * as bufutil from "../../commons/bufutil.js";
import * as envutil from "../../commons/envutil.js";
import * as util from "../../commons/util.js";
import * as cfg from "../../core/cfg.js";
import { log } from "../../core/log.js";
import * as pres from "../plugin-response.js";
import * as rdnsutil from "../rdns-util.js";
import { BlocklistFilter } from "./filter.js";
import { withDefaults } from "./trie-config.js";

// number of range fetches for trie.txt; -1 to disable
const maxrangefetches = 2;

const basicconfigDir = "bc";
const bcFilename = "basicconfig.json";
const ftFilename = "filetag.json";
const defaultCodec = "u6";
const maxRenewAttempts = 5;

export class BlocklistWrapper {
  constructor() {
    /** @type {BlocklistFilter} */
    this.blocklistFilter = new BlocklistFilter();
    /** @type {number} */
    this.startTime = Date.now(); // blocklist download timestamp
    /** @type {boolean} */
    this.isBlocklistUnderConstruction = false;
    /** @type {string} */
    this.exceptionFrom = "";
    /** @type {string} */
    this.exceptionStack = "";
    /** @type {boolean} */
    this.noop = envutil.disableBlocklists();
    /** @type {boolean} */
    this.nowait = envutil.bgDownloadBlocklistWrapper();

    this.log = log.withTags("BlocklistWrapper");

    if (this.noop) this.log.w("disabled?", this.noop);
  }

  async init(rxid, forceget = false) {
    if (this.isBlocklistFilterSetup() || this.disabled()) {
      const blres = pres.emptyResponse();
      blres.data.blocklistFilter = this.blocklistFilter; // may be nil
      return blres;
    }

    try {
      const now = Date.now();

      if (
        !this.isBlocklistUnderConstruction ||
        // it has been a while, queue another blocklist-construction
        now - this.startTime > envutil.downloadTimeout() * 2
      ) {
        this.log.i(rxid, "download blocklists", now, this.startTime);
        return this.initBlocklistConstruction(rxid, now);
      } else if (this.nowait && !forceget) {
        // blocklist-construction is in progress, but we don't have to
        // wait for it to finish. So, return an empty response.
        this.log.i(rxid, "nowait, but blocklist construction ongoing");
        return pres.emptyResponse();
      } else {
        // someone's constructing... wait till finished
        return this.waitUntilDone(rxid);
      }
    } catch (e) {
      this.log.e(rxid, "main", e.stack);
      return pres.errResponse("blocklistWrapper", e);
    }
  }

  disabled() {
    return this.noop;
  }

  getBlocklistFilter() {
    return this.blocklistFilter;
  }

  isBlocklistFilterSetup() {
    return rdnsutil.isBlocklistFilterSetup(this.blocklistFilter);
  }

  async waitUntilDone(rxid) {
    // res.arrayBuffer() is the most expensive op, taking anywhere
    // between 700ms to 1.2s for trie. But: We don't want all incoming
    // reqs to wait until the trie becomes available. 400ms is 1/3rd of
    // 1.2s and 2x 250ms; both of these values have cost implications:
    // 250ms (0.028GB-sec or 218ms wall time) in unbound-worker per req
    // equals cost of one bundled-worker req.
    // ~7800ms is 1GB-sec; 10s (overall download timeout) is 1.3GB-sec.
    // and 5s is 0.065GB-sec (which is the request timeout).
    let totalWaitms = 0;
    const waitms = 25;
    const response = pres.emptyResponse();
    while (totalWaitms < envutil.downloadTimeout()) {
      if (this.isBlocklistFilterSetup()) {
        this.log.i(rxid, "blocklistWrapper: download done:", totalWaitms);
        response.data.blocklistFilter = this.blocklistFilter;
        return response;
      }
      await util.sleep(waitms);
      totalWaitms += waitms;
    }

    this.log.e(rxid, "blocklistWrapper", "download timed out:", totalWaitms);
    response.isException = true;
    response.exceptionStack = this.exceptionStack || "download timeout";
    response.exceptionFrom = this.exceptionFrom || "blocklistWrapper.js";
    return response;
  }

  /**
   *
   * @param {ArrayBufferLike} td
   * @param {ArrayBufferLike} rd
   * @param {Object} ftags
   * @param {Object} bconfig
   */
  buildBlocklistFilter(td, rd, ftags, bconfig) {
    this.isBlocklistUnderConstruction = true;
    this.startTime = Date.now();
    // if optflags is undefined, then explicitly set it to be false
    bconfig = withDefaults(bconfig);
    const ftrie = this.makeTrie(td, rd, bconfig);
    this.blocklistFilter.load(ftrie, ftags);
    this.log.i("fs:trie w/ config", bconfig);
    this.isBlocklistUnderConstruction = false;
  }

  makeTrie(tdbuf, rdbuf, bconfig) {
    return createTrie(tdbuf, rdbuf, bconfig);
  }

  /**
   * @param {string} rxid
   * @param {int} when
   * @returns {Promise<pres.RResp>}
   */
  async initBlocklistConstruction(rxid, when) {
    this.isBlocklistUnderConstruction = true;
    this.startTime = when;

    const baseurl = envutil.blocklistUrl();

    let bconfig = withDefaults(cfg.orig());
    let ft = cfg.filetag();
    // if bconfig.timestamp is older than AUTO_RENEW_BLOCKLISTS_OLDER_THAN
    // then download the latest filetag (ft) and basicconfig (bconfig).
    if (!envutil.disableBlocklists()) {
      const blocklistAgeThresWeeks = envutil.renewBlocklistsThresholdInWeeks();
      const bltimestamp = util.bareTimestampFrom(cfg.timestamp());
      if (isPast(bltimestamp, blocklistAgeThresWeeks)) {
        const [renewCfg, renewedFt] = await renew(baseurl);

        if (renewCfg != null && renewedFt != null) {
          this.log.i(rxid, "r:", bconfig.timestamp, "=>", renewCfg.timestamp);
          bconfig = withDefaults(renewCfg);
          ft = renewedFt;
        } else {
          this.log.w(rxid, "r: failed; got:", renewCfg);
        }
      } else {
        this.log.d(rxid, "r: not needed for:", bltimestamp);
      }
    }

    let response = pres.emptyResponse();
    try {
      await this.downloadAndBuildBlocklistFilter(rxid, bconfig, ft);

      this.log.i(rxid, "blocklist-filter setup; u6?", bconfig.useCodec6);
      if (false) {
        // test
        const result = this.blocklistFilter.blockstamp("google.com");
        this.log.d(rxid, JSON.stringify(result));
      }

      response.data.blocklistFilter = this.blocklistFilter;
    } catch (e) {
      this.log.e(rxid, "initBlocklistConstruction", e);
      response = pres.errResponse("initBlocklistConstruction", e);
      this.exceptionFrom = response.exceptionFrom;
      this.exceptionStack = response.exceptionStack;
    }

    this.isBlocklistUnderConstruction = false;

    return response;
  }

  async downloadAndBuildBlocklistFilter(rxid, bconfig, ft) {
    const tdNodecount = bconfig.nodecount; // or: cfg.tdNodeCount();
    const tdParts = bconfig.tdparts; // or: cfg.tdParts();
    const u6 = bconfig.useCodec6; // or: cfg.tdCodec6();

    let url = envutil.blocklistUrl() + bconfig.timestamp + "/";
    url += u6 ? "u6/" : "u8/";

    !tdNodecount && this.log.e(rxid, "tdNodecount zero or missing!");

    this.log.d(rxid, url, tdNodecount, tdParts);
    const buf0 = fileFetch(url + "rd.txt", "buffer");
    const buf1 = maxrangefetches > 0 ? rangeTd(url) : makeTd(url, tdParts);

    const downloads = await Promise.all([buf0, buf1]);

    this.log.i(rxid, "d:trie w/ config", bconfig);

    const rd = downloads[0];
    const td = downloads[1];

    const ftrie = this.makeTrie(td, rd, bconfig);

    this.blocklistFilter.load(ftrie, ft);
  }

  triedata() {
    if (!rdnsutil.isBlocklistFilterSetup(this.blocklistFilter)) {
      throw new Error("no triedata: blocklistFilter not loaded");
    }
    const blf = this.blocklistFilter;
    const ftrie = blf.ftrie;
    const rdir = ftrie.directory;
    const d = rdir.data;
    return bufutil.raw(d.bytes);
  }

  rankdata() {
    if (!rdnsutil.isBlocklistFilterSetup(this.blocklistFilter)) {
      throw new Error("no rankdata: blocklistFilter not loaded");
    }
    const blf = this.blocklistFilter;
    const ftrie = blf.ftrie;
    const rdir = ftrie.directory;
    const d = rdir.directory;
    return bufutil.raw(d.bytes);
  }

  filetag() {
    if (!rdnsutil.isBlocklistFilterSetup(this.blocklistFilter)) {
      throw new Error("no filetag: blocklistFilter not loaded");
    }
    const blf = this.blocklistFilter;
    return blf.filetag;
  }

  basicconfig() {
    if (!rdnsutil.isBlocklistFilterSetup(this.blocklistFilter)) {
      throw new Error("no basicconfig: blocklistFilter not loaded");
    }
    const blf = this.blocklistFilter;
    const ftrie = blf.ftrie;
    const rdir = ftrie.directory;
    return rdir.config;
  }

  /**
   * Returns the timestamp of the blocklist (epochMillis or yyyy/epochMillis)
   * @param {string} defaultTimestamp
   * @returns {string} timestamp
   * @throws {Error} if timestamp could not be determined and defaultTimestamp is empty.
   */
  timestamp(defaultTimestamp = "") {
    try {
      const bc = this.basicconfig();
      if (bc == null) {
        throw new Error("missing basicconfig");
      }
      if (util.emptyString(bc.timestamp)) {
        throw new Error("basicconfig missing timestamp");
      }
      return bc.timestamp;
    } catch (ex) {
      // debug: this.log.d("blocklistWrapper: get timestamp", ex);
      if (util.emptyString(defaultTimestamp)) {
        throw ex;
      }
    }
    return defaultTimestamp;
  }

  codec() {
    const tdcodec6 = this.basicconfig().useCodec6;
    return tdcodec6 ? "u6" : "u8";
  }
}

async function fileFetch(url, typ, h = {}) {
  if (typ !== "buffer" && typ !== "json") {
    log.i("fetch fail", typ, url);
    throw new Error("Unknown conversion type at fileFetch");
  }

  let res = { ok: false };
  try {
    log.i("downloading", url, typ, h);
    // Note: cacheEverything is needed as Cloudflare does not
    // cache .txt and .json blobs, even when a cacheTtl is specified.
    // ref: developers.cloudflare.com/cache/about/default-cache-behavior
    // cacheEverything overrides that behaviour and forces Cloudflare to
    // cache the blob regardless of the extension. In addition, CacheRules
    // are also enabled on all 3 origins viz cf / dist / cfstore
    // docs: developers.cloudflare.com/cache/about/cache-rules
    res = await fetch(url, {
      headers: h,
      cf: {
        cacheTtl: /* 30d */ 2592000,
        cacheEverything: true,
      },
    });
  } catch (ex) {
    log.w("download failed", url, ex, ex.cause);
    throw ex;
  }

  if (!res.ok) {
    log.e("file-fetch err", url, res);
    throw new Error(JSON.stringify([url, res, "fileFetch fail"]));
  }

  if (typ === "buffer") {
    return await res.arrayBuffer();
  } else if (typ === "json") {
    return await res.json();
  }
}

async function rangeTd(baseurl) {
  log.i("rangeTd from chunks", maxrangefetches);

  const f = baseurl + "td.txt";
  // assume accept-ranges: bytes is present (true for R2 and S3)
  // developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests#checking_if_a_server_supports_partial_requests
  const hreq = await fetch(f, { method: "HEAD" });
  const contentlength = hreq.headers.get("content-length");
  const n = parseInt(contentlength, 10);

  // download in n / max chunks
  const chunksize = Math.ceil(n / maxrangefetches);
  const promisedchunks = [];
  let i = 0;
  do {
    // both i and j are inclusive: stackoverflow.com/a/39701075
    const j = Math.min(n - 1, i + chunksize - 1);
    const rg = { range: `bytes=${i}-${j}` };
    promisedchunks.push(fileFetch(f, "buffer", rg));
    i = j + 1;
  } while (i < n);

  const chunks = await Promise.all(promisedchunks);
  log.i("trie chunks downloaded");

  return bufutil.concat(chunks);
}

// joins split td parts into one td
async function makeTd(baseurl, n) {
  log.i("makeTd from tdParts", n);

  if (n <= -1) {
    return fileFetch(baseurl + "td.txt", "buffer");
  }

  const tdpromises = [];
  for (let i = 0; i <= n; i++) {
    // td00.txt, td01.txt, td02.txt, ... , td98.txt, td100.txt, ...
    const f =
      baseurl +
      "td" +
      i.toLocaleString("en-US", {
        minimumIntegerDigits: 2,
        useGrouping: false,
      }) +
      ".txt";
    tdpromises.push(fileFetch(f, "buffer"));
  }
  const tds = await Promise.all(tdpromises);

  log.i("tds downloaded");

  return bufutil.concat(tds);
}

/**
 * @typedef {Object} DateInfo
 * @property {number} day
 * @property {number} week
 * @property {number} month
 * @property {number} year
 * @property {number} timestamp
 */

/**
 * @returns {DateInfo}
 */
function todayAsDateInfo() {
  const date = new Date();
  const day = date.getUTCDate();
  const week = Math.ceil(day / 7);
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  const timestamp = date.getTime();
  return { day, week, month, year, timestamp };
}

/**
 * Main function to prefetch files based on week, month, and year.
 * @param {string} baseurl
 * @returns {Promise<[Object?, Object?]>} [basicconfig, filetag]
 */
async function renew(baseurl) {
  let { week: wk, month: mm, year: yyyy, timestamp: now } = todayAsDateInfo();

  for (let i = 0; i <= maxRenewAttempts; i++) {
    const configUrl = `${baseurl}${yyyy}/${basicconfigDir}/${mm}-${wk}/${defaultCodec}/${bcFilename}`;
    log.i(`attempt ${i}: fetching ${configUrl} at ${now}`);

    try {
      // {
      //   "version":1,
      //   "nodecount":81551789,
      //   "inspect":false,
      //   "debug":false,
      //   "selectsearch":true,
      //   "useCodec6":true,
      //   "optflags":true,
      //   "tdpartsmaxmb":0,
      //   "timestamp":"2025/1740866164283",
      //   "tdparts":-1,
      //   "tdmd5":"000ed9638e8e0f12e450050997e84365",
      //   "rdmd5":"75e5eebc71be02d8bef47b93ea58c213",
      //   "ftmd5":"8c56effb0f3d73232f7090416bb2e7c1",
      //   "ftlmd5":"54b323eb653451ba8940acb00d20382a"
      // }
      const bconfig = await fileFetch(configUrl, "json");

      if (bconfig) {
        const fullTimestamp = bconfig.timestamp;
        if (fullTimestamp) {
          const codec = bconfig.useCodec6 ? "u6" : "u8";
          const tagUrl = `${baseurl}${fullTimestamp}/${codec}/${ftFilename}`;
          log.i(`attempt ${i}: fetching ${configUrl} at ${now}`);

          const ft = await fileFetch(tagUrl, "json");

          if (ft) return [bconfig, ft];
          else log.w(`failed to fetch ${tagUrl}`);
        }
      }
      log.w(`renew #${i} failed for:`, bconfig);
    } catch (ex) {
      // ex: 4xx, 5xx
      log.w(`renew #${i} err; retrying...`, ex);
    }

    // decr week, month, year; try again
    wk--;
    if (wk <= 0) {
      wk = 5;
      mm--;
    }
    if (mm <= 0) {
      mm = 12;
      yyyy--;
    }
  }

  log.e("no new filetag or basicconfig: exceeded max retries");
  return [null, null];
}

/**
 * Returns true if the timestamp is older than wk weeks, per Date.now()
 * @param {int} tsms (in unix millis)
 * @param {int} wk (in weeks > 0)
 * @returns {bool}
 */
export function isPast(tsms, wk) {
  if (tsms <= 0 || wk <= 0) {
    log.w("isPast: bad args ts/wk", tsms, wk);
    return false;
  }

  const since = Date.now() - tsms;
  const sinceWeeks = Math.floor(since / (1000 * 60 * 60 * 24 * 7));

  const y = sinceWeeks > wk;
  const note = y ? log.w : log.i;
  note("blocklist old?", y, sinceWeeks, ">", wk, " / s:", since, "ts:", tsms);
  return y;
}
