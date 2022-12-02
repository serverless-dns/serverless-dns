/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { createTrie } from "@serverless-dns/trie/ftrie.js";
import { BlocklistFilter } from "./filter.js";
import { withDefaults } from "./trie-config.js";
import * as cfg from "../../core/cfg.js";
import * as bufutil from "../../commons/bufutil.js";
import * as util from "../../commons/util.js";
import * as envutil from "../../commons/envutil.js";
import * as rdnsutil from "../rdns-util.js";

export class BlocklistWrapper {
  constructor() {
    this.blocklistFilter = new BlocklistFilter();
    this.startTime = Date.now(); // blocklist download timestamp
    this.isBlocklistUnderConstruction = false;
    this.exceptionFrom = "";
    this.exceptionStack = "";
    this.noop = envutil.disableBlocklists();
    this.nowait = envutil.bgDownloadBlocklistWrapper();

    this.log = log.withTags("BlocklistWrapper");

    if (this.noop) this.log.w("disabled?", this.noop);
  }

  async init(rxid) {
    if (this.isBlocklistFilterSetup() || this.disabled()) {
      const blres = util.emptyResponse();
      blres.data.blocklistFilter = this.blocklistFilter;
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
        const url = envutil.blocklistUrl() + cfg.timestamp() + "/";
        const nc = cfg.tdNodeCount();
        const parts = cfg.tdParts();
        const u6 = cfg.tdCodec6();
        return this.initBlocklistConstruction(rxid, now, url, nc, parts, u6);
      } else if (this.nowait) {
        // blocklist-construction is in progress, but we don't have to
        // wait for it to finish. So, return an empty response.
        this.log.i(rxid, "nowait, but blocklist construction ongoing");
        return util.emptyResponse();
      } else {
        // someone's constructing... wait till finished
        return this.waitUntilDone();
      }
    } catch (e) {
      this.log.e(rxid, "main", e.stack);
      return util.errResponse("blocklistWrapper", e);
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

  async waitUntilDone() {
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
    const response = util.emptyResponse();
    while (totalWaitms < envutil.downloadTimeout()) {
      if (this.isBlocklistFilterSetup()) {
        response.data.blocklistFilter = this.blocklistFilter;
        return response;
      }
      await util.sleep(waitms);
      totalWaitms += waitms;
    }

    response.isException = true;
    response.exceptionStack = this.exceptionStack || "download timeout";
    response.exceptionFrom = this.exceptionFrom || "blocklistWrapper.js";
    return response;
  }

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

  async initBlocklistConstruction(
    rxid,
    when,
    url,
    tdNodecount,
    tdParts,
    tdCodec6
  ) {
    this.isBlocklistUnderConstruction = true;
    this.startTime = when;

    let response = util.emptyResponse();
    try {
      await this.downloadAndBuildBlocklistFilter(
        rxid,
        url,
        tdNodecount,
        tdParts,
        tdCodec6
      );

      this.log.i(rxid, "blocklist-filter setup; u6?", tdCodec6);
      if (false) {
        // test
        const result = this.blocklistFilter.blockstamp("google.com");
        this.log.d(rxid, JSON.stringify(result));
      }

      response.data.blocklistFilter = this.blocklistFilter;
    } catch (e) {
      this.log.e(rxid, "initBlocklistConstruction", e);
      response = util.errResponse("initBlocklistConstruction", e);
      this.exceptionFrom = response.exceptionFrom;
      this.exceptionStack = response.exceptionStack;
    }

    this.isBlocklistUnderConstruction = false;

    return response;
  }

  async downloadAndBuildBlocklistFilter(rxid, url, tdNodecount, tdParts, u6) {
    !tdNodecount && this.log.e(rxid, "tdNodecount zero or missing!");

    const bconfig = withDefaults(cfg.orig());
    const ft = cfg.filetag();

    if (
      bconfig.useCodec6 !== u6 ||
      bconfig.nodecount !== tdNodecount ||
      bconfig.tdparts !== tdParts
    ) {
      throw new Error(bconfig + "<=cfg; in=>" + u6 + " " + tdNodecount);
    }

    url += bconfig.useCodec6 ? "u6/" : "u8/";

    this.log.d(rxid, url, tdNodecount, tdParts);
    const buf0 = fileFetch(url + "rd.txt", "buffer");
    const buf1 = makeTd(url, bconfig.tdparts);

    const downloads = await Promise.all([buf0, buf1]);

    this.log.i(rxid, "d:trie w/ config", bconfig);

    const rd = downloads[0];
    const td = downloads[1];

    const ftrie = this.makeTrie(td, rd, bconfig);

    this.blocklistFilter.load(ftrie, ft);

    return;
  }

  triedata() {
    const blf = this.blocklistFilter;
    const ftrie = blf.ftrie;
    const rdir = ftrie.directory;
    const d = rdir.data;
    return bufutil.raw(d.bytes);
  }

  rankdata() {
    const blf = this.blocklistFilter;
    const ftrie = blf.ftrie;
    const rdir = ftrie.directory;
    const d = rdir.directory;
    return bufutil.raw(d.bytes);
  }
}

async function fileFetch(url, typ) {
  if (typ !== "buffer" && typ !== "json") {
    log.i("fetch fail", typ, url);
    throw new Error("Unknown conversion type at fileFetch");
  }

  let res = { ok: false };
  try {
    log.i("downloading", url, typ);
    // Note: cacheEverything is needed as Cloudflare does not
    // cache .txt and .json blobs, even when a cacheTtl is specified.
    // ref: developers.cloudflare.com/cache/about/default-cache-behavior
    // cacheEverything overrides that behaviour and forces Cloudflare to
    // cache the blob regardless of the extension. In addition, CacheRules
    // are also enabled on all 3 origins viz cf / dist / cfstore
    // docs: developers.cloudflare.com/cache/about/cache-rules
    res = await fetch(url, {
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
