/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as bufutil from "../../commons/bufutil.js";
import * as envutil from "../../commons/envutil.js";
import * as cfg from "../../core/cfg.js";
import { BlocklistWrapper } from "../../plugins/rethinkdns/main.js";

const blocklistsDir = "blocklists__";
const tdFile = "td.txt";
const rdFile = "rd.txt";

export async function setup(bw: any) {
  if (!bw || !envutil.hasDisk()) return false;

  const now = Date.now();
  const timestamp = cfg.timestamp() as string;
  const url = envutil.blocklistUrl() + timestamp + "/";
  const nodecount = cfg.tdNodeCount() as number;
  const tdparts = cfg.tdParts() as number;
  const tdcodec6 = cfg.tdCodec6() as boolean;
  const codec = tdcodec6 ? "u6" : "u8";

  const ok = setupLocally(bw, timestamp, codec);
  if (ok) {
    console.info("bl setup locally tstamp/nc", timestamp, nodecount);
    return true;
  }

  console.info("dowloading bl url/codec?", url, codec);
  await bw.initBlocklistConstruction(
    /* rxid*/ "bl-download",
    now,
    url,
    nodecount,
    tdparts,
    tdcodec6
  );

  save(bw, timestamp, codec);
}

function save(bw: BlocklistWrapper, timestamp: string, codec: string) {
  if (!bw.isBlocklistFilterSetup()) return false;

  mkdirsIfNeeded(timestamp, codec);

  const [tdfp, rdfp] = getFilePaths(timestamp, codec);

  const td = bw.triedata();
  const rd = bw.rankdata();
  // Deno only writes uint8arrays to disk, never raw arraybuffers
  Deno.writeFileSync(tdfp, new Uint8Array(td));
  Deno.writeFileSync(rdfp, new Uint8Array(rd));

  console.info("blocklists written to disk");

  return true;
}

function setupLocally(bw: any, ts: string, codec: string) {
  if (!hasBlocklistFiles(ts, codec)) return false;

  const [td, rd] = getFilePaths(ts, codec);
  console.info("on-disk c:td/rd", codec, td, rd);

  const tdbuf = Deno.readFileSync(td);
  const rdbuf = Deno.readFileSync(rd);

  if (tdbuf.byteLength <= 0 || rdbuf.byteLength <= 0) {
    return false;
  }

  // TODO: file integrity checks
  // concat converts uint8array to an untyped arraybuffer
  // that the rethinkdns module expects, 'cause the actual
  // type required is uint16array for the trie
  const ab0 = bufutil.concat([tdbuf]);
  const ab1 = bufutil.concat([rdbuf]);
  const json1 = cfg.filetag();
  const json2 = cfg.orig();

  bw.buildBlocklistFilter(
    /* trie*/ ab0,
    /* rank-dir*/ ab1,
    /* file-tag*/ json1,
    /* basic-config*/ json2
  );

  return true;
}

function hasBlocklistFiles(timestamp: string, codec: string) {
  const [td, rd] = getFilePaths(timestamp, codec);

  try {
    const tdinfo = Deno.statSync(td);
    const rdinfo = Deno.statSync(rd);

    return tdinfo.isFile && rdinfo.isFile;
  } catch (ignored) {}

  return false;
}

function getFilePaths(t: string, c: string) {
  const cwd = Deno.cwd();

  const td = cwd + "/" + blocklistsDir + "/" + t + "/" + c + "/" + tdFile;
  const rd = cwd + "/" + blocklistsDir + "/" + t + "/" + c + "/" + rdFile;

  return [td, rd];
}

function getDirPaths(t: string, c: string) {
  const cwd = Deno.cwd();

  const bldir = cwd + "/" + blocklistsDir;
  const tsdir = cwd + "/" + blocklistsDir + "/" + t;
  const codecdir = cwd + "/" + blocklistsDir + "/" + t + "/" + c;

  return [bldir, tsdir, codecdir];
}

function mkdirsIfNeeded(timestamp: string, codec: string) {
  // deno.land/api@v1.27.1?s=Deno.MkdirOptions
  const opts = { recursive: true };
  const [dir1, dir2, dir3] = getDirPaths(timestamp, codec);
  let dinfo1 = null;
  let dinfo2 = null;
  let dinfo3 = null;

  try {
    dinfo1 = Deno.statSync(dir1);
    dinfo2 = Deno.statSync(dir2);
    dinfo3 = Deno.statSync(dir3);
  } catch (ignored) {}

  if (!dinfo1 || !dinfo1.isDirectory) {
    console.info("creating dir", dir1);
    Deno.mkdirSync(dir1, opts);
  }

  if (!dinfo2 || !dinfo2.isDirectory) {
    console.info("creating dir", dir2);
    Deno.mkdirSync(dir2, opts);
  }

  if (!dinfo3 || !dinfo3.isDirectory) {
    console.info("creating dir", dir3);
    Deno.mkdirSync(dir3, opts);
  }
}
