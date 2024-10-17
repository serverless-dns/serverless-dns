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
// import mmap from "@riaskov/mmap-io";

const blocklistsDir = "./blocklists__";
const tdFile = "td.txt";
const rdFile = "rd.txt";

export async function setup(bw) {
  if (!bw || !envutil.hasDisk()) return false;

  const now = Date.now();
  // timestamp is of form yyyy/epochMs
  const timestamp = cfg.timestamp();
  const url = envutil.blocklistUrl() + timestamp + "/";
  const nodecount = cfg.tdNodeCount();
  const tdparts = cfg.tdParts();
  const tdcodec6 = cfg.tdCodec6();
  const codec = tdcodec6 ? "u6" : "u8";
  const useMmap = envutil.useMmap();

  const ok = await setupLocally(bw, timestamp, codec, useMmap);
  if (ok) {
    log.i("bl setup locally tstamp/nc", timestamp, nodecount);
    return true;
  }

  log.i("dowloading bl u/u6?/nc/parts", url, tdcodec6, nodecount, tdparts);
  await bw.initBlocklistConstruction(
    /* rxid*/ "bl-download",
    now,
    url,
    nodecount,
    tdparts,
    tdcodec6
  );

  return save(bw, timestamp, codec);
}

function save(bw, timestamp, codec) {
  if (!bw.isBlocklistFilterSetup()) return false;

  mkdirsIfNeeded(timestamp, codec);

  const [tdfp, rdfp] = getFilePaths(timestamp, codec);

  const td = bw.triedata();
  const rd = bw.rankdata();
  // write out array-buffers to disk
  fs.writeFileSync(tdfp, bufutil.bufferOf(td));
  fs.writeFileSync(rdfp, bufutil.bufferOf(rd));

  log.i("blocklists written to disk");

  return true;
}

// fmmap mmaps file at fp for random reads, returns a Buffer backed by the file.
async function fmmap(fp) {
  const dynimports = envutil.hasDynamicImports();
  const isNode = envutil.isNode();
  const isBun = envutil.isBun();
  const isDeno = envutil.isDeno();

  if (dynimports && isNode) {
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

async function setupLocally(bw, timestamp, codec, useMmap) {
  const ok = hasBlocklistFiles(timestamp, codec);
  log.i(timestamp, codec, "has bl files?", ok);
  if (!ok) return false;

  const [td, rd] = getFilePaths(timestamp, codec);
  log.i("on-disk codec/td/rd", codec, td, rd, "mmap?", useMmap);

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

function getFilePaths(t, codec) {
  const td = blocklistsDir + "/" + t + "/" + codec + "/" + tdFile;
  const rd = blocklistsDir + "/" + t + "/" + codec + "/" + rdFile;

  return [path.normalize(td), path.normalize(rd)];
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
