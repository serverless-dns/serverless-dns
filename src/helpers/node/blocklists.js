/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as fs from "fs";
import * as path from "path";
import * as util from "../util.js";
import * as envutil from "../envutil.js";

const blocklistsDir = "./blocklists__";
const tdFile = "td.txt";
const rdFile = "rd.txt";
const ftFile = "filetag.json";

export async function setup(bw) {

  if (!bw || !envutil.hasDisk()) return false;

  const now = Date.now();
  const url = envutil.blocklistUrl();
  const timestamp = envutil.timestamp();
  const nodecount = envutil.tdNodeCount();
  const tdparts = envutil.tdParts();

  const ok = setupLocally(bw, timestamp, nodecount);
  if (ok) {
    log.i("bl setup locally tstamp/nc", timestamp, nodecount);
    return true;
  }

  log.i("dowloading bl tstamp/nc/parts", timestamp, nodecount, tdparts);
  await bw.initBlocklistConstruction(
    now,
    url,
    timestamp,
    nodecount,
    tdparts
  );

  save(bw, timestamp);
}

function save(bw, timestamp) {
  if (!bw.isBlocklistFilterSetup()) return false;

  mkdirsIfNeeded(timestamp);

  const [tdfp, rdfp, ftfp] = getFilePaths(timestamp);

  // write out array-buffers to disk
  fs.writeFileSync(tdfp, util.bufferOf(bw.td));
  fs.writeFileSync(rdfp, util.bufferOf(bw.rd));
  fs.writeFileSync(ftfp, JSON.stringify(bw.ft));

  log.i("blocklists written to disk");

  return true;
}

function setupLocally(bw, timestamp, nodecount) {
  if (!hasBlocklistFiles(timestamp)) return false;

  const [td, rd, ft] = getFilePaths(timestamp);
  log.i("on-disk td/rd/ft", td, rd, ft);

  const tdbuf = fs.readFileSync(td);
  const rdbuf = fs.readFileSync(rd);
  const ftbuf = fs.readFileSync(ft, "utf-8");

  // TODO: file integrity checks
  const ab0 = util.arrayBufferOf(tdbuf);
  const ab1 = util.arrayBufferOf(rdbuf);
  const json1 = JSON.parse(ftbuf);
  const json2 = { nodecount: nodecount };

  bw.initBlocklistFilterConstruction(
    /*trie*/ ab0,
    /*rank-dir*/ ab1,
    /*file-tag*/ json1,
    /*basic-config*/ json2
  );

  return true;
}

function hasBlocklistFiles(timestamp) {
  const [td, rd, ft] = getFilePaths(timestamp);

  return fs.existsSync(td) && fs.existsSync(rd) && fs.existsSync(ft);
}

function getFilePaths(t) {
  const td = path.normalize(blocklistsDir + "/" + t + "/" + tdFile);
  const rd = path.normalize(blocklistsDir + "/" + t + "/" + rdFile);
  const ft = path.normalize(blocklistsDir + "/" + t + "/" + ftFile);

  return [td, rd, ft];
}

function getDirPaths(t) {
  const bldir = path.normalize(blocklistsDir);
  const tsdir = path.normalize(blocklistsDir + "/" + t);

  return [bldir, tsdir];
}

function mkdirsIfNeeded(timestamp) {
  const [dir1, dir2] = getDirPaths(timestamp);

  if (!fs.existsSync(dir1)) {
    log.i("creating blocklist dir", dir1)
    fs.mkdirSync(dir1);
  }

  if (!fs.existsSync(dir2)) {
    log.i("creating timestamp dir", dir2)
    fs.mkdirSync(dir2);
  }
}

