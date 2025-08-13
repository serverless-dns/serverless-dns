/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as bufutil from "../../commons/bufutil.js";
import * as envutil from "../../commons/envutil.js";
import * as cfg from "../../core/cfg.js";
import { BlocklistWrapper } from "../../plugins/rethinkdns/main.js";
// import mmap from "@riaskov/mmap-io";

const blocklistsDir = "./blocklists__";
const tdFile = "td.txt";
const rdFile = "rd.txt";
const bcFile = "basicconfig.json";
const ftFile = "filetag.json";

/**
 *
 * @param {BlocklistWrapper} bw
 * @returns
 */
export async function setup(bw) {
  if (!bw || !envutil.hasDisk()) return false;

  const ok = await setupLocally(bw);
  if (ok) {
    return true;
  }

  log.i("dowloading blocklists");
  await bw.init(/* rxid */ "bl-download", /* wait */ true);

  return save(bw);
}

/**
 * @param {BlocklistWrapper} bw
 * @returns {boolean}
 */
function save(bw) {
  if (!bw.isBlocklistFilterSetup()) return false;

  const timestamp = bw.timestamp();
  const codec = bw.codec();
  mkdirsIfNeeded(timestamp, codec);

  const [tdfp, rdfp, bcfp, ftfp] = getFilePaths(timestamp, codec);

  const td = bw.triedata();
  const rd = bw.rankdata();
  const filetag = bw.filetag();
  const basicconfig = bw.basicconfig();
  // write out array-buffers to disk
  fs.writeFileSync(tdfp, bufutil.bufferOf(td));
  fs.writeFileSync(rdfp, bufutil.bufferOf(rd));
  // write out json objects to disk; may overwrite existing files
  fs.writeFileSync(ftfp, JSON.stringify(filetag));
  fs.writeFileSync(bcfp, JSON.stringify(basicconfig));

  log.i("blocklist files written to disk", tdfp, rdfp, bcfp, ftfp);

  return true;
}

/**
 * fmmap mmaps file at fp for random reads, returns a Buffer backed by the file.
 * @param {string} fp
 * @returns {Buffer?}
 */
async function fmmap(fp) {
  const dynimports = envutil.hasDynamicImports();
  const isNode = envutil.isNode();
  const isBun = envutil.isBun();
  const isDeno = envutil.isDeno();

  if (dynimports && isNode) {
    log.i("mmap f:", fp, "on node");
    try {
      const mmap = (await import("@riaskov/mmap-io")).default;
      const fd = fs.openSync(fp, "r+");
      const fsize = fs.fstatSync(fd).size;
      const rxprot = mmap.PROT_READ; // protection
      const mpriv = mmap.MAP_SHARED; // privacy
      const madv = mmap.MADV_RANDOM; // madvise
      const offset = 0;
      log.i("mmap f:", fp, "size:", fsize, "\nNOTE: md5 checks will fail");
      return mmap.map(fsize, rxprot, mpriv, fd, offset, madv);
    } catch (ex) {
      log.e("mmap f:", fp, "import failed", ex);
      return null;
    }
  } else if (isBun) {
    log.i("mmap f:", fp, "on bun");
    return Bun.mmap(fp);
  } else if (isDeno) {
    log.i("mmap f:", fp, "unavailable on deno");
  }
  return null;
}

/**
 * setupLocally loads blocklist files and configurations from disk.
 * TODO: return false if blocklists age > AUTO_RENEW_BLOCKLISTS_OLDER_THAN
 * @param {BlocklistWrapper} bw
 * @returns
 */
async function setupLocally(bw) {
  // timestamp is of form yyyy/epochMs
  const timestamp = cfg.timestamp();
  const tdcodec6 = cfg.tdCodec6();
  const codec = tdcodec6 ? "u6" : "u8";
  const useMmap = envutil.useMmap();

  const ok = hasBlocklistFiles(timestamp, codec);
  log.i(timestamp, codec, "has bl files?", ok);
  if (!ok) return false;

  const [td, rd] = getFilePaths(timestamp, codec);
  log.i("on-disk ts/codec/td/rd", timestamp, codec, td, rd, "mmap?", useMmap);

  let tdbuf = useMmap ? await fmmap(td) : null;
  if (bufutil.emptyBuf(tdbuf)) {
    tdbuf = fs.readFileSync(td);
  }
  const rdbuf = fs.readFileSync(rd);

  // TODO: file integrity checks
  const ab0 = bufutil.raw(tdbuf);
  const ab1 = bufutil.raw(rdbuf);
  const json1 = cfg.filetag();
  const json2 = cfg.orig();

  // TODO: Fix basicconfig
  bw.buildBlocklistFilter(
    /* trie*/ ab0,
    /* rank-dir*/ ab1,
    /* file-tag*/ json1,
    /* basic-config*/ json2
  );

  return true;
}

function hasBlocklistFiles(timestamp, codec) {
  const [td, rd] = getFilePaths(timestamp, codec);

  return fs.existsSync(td) && fs.existsSync(rd);
}

/**
 *
 * @param {string} t
 * @param {string} codec
 * @returns {string[]} array of file paths [td, rd, bc, ft]
 */
function getFilePaths(t, codec) {
  const td = blocklistsDir + "/" + t + "/" + codec + "/" + tdFile;
  const rd = blocklistsDir + "/" + t + "/" + codec + "/" + rdFile;
  const bc = codec + "-" + bcFile;
  const ft = codec + "-" + ftFile;

  return [
    path.normalize(td),
    path.normalize(rd),
    path.normalize(bc),
    path.normalize(ft),
  ];
}

function getDirPaths(t, codec) {
  const bldir = path.normalize(blocklistsDir);
  const tsdir = path.normalize(blocklistsDir + "/" + t);
  const codecdir = path.normalize(blocklistsDir + "/" + t + "/" + codec);

  return [bldir, tsdir, codecdir];
}

function mkdirsIfNeeded(timestamp, codec) {
  const opts = { recursive: true };
  const [dir1, dir2, dir3] = getDirPaths(timestamp, codec);

  if (!fs.existsSync(dir1)) {
    log.i("creating blocklist dir", dir1);
    fs.mkdirSync(dir1, opts);
  }

  if (!fs.existsSync(dir2)) {
    log.i("creating timestamp dir", dir2);
    fs.mkdirSync(dir2, opts);
  }

  if (!fs.existsSync(dir3)) {
    log.i("creating codec dir", dir2);
    fs.mkdirSync(dir3, opts);
  }
}
