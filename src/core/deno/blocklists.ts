/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as util from "../../commons/util.js";
import * as bufutil from "../../commons/bufutil.js";
import * as envutil from "../../commons/envutil.js";

const blocklistsDir = "blocklists__";
const tdFile = "td.txt";
const rdFile = "rd.txt";
const ftFile = "filetag.json";

export async function setup(bw: any) {
  if (!bw || !envutil.hasDisk()) return false;

  const now = Date.now();
  const url = envutil.blocklistUrl() as string;
  const timestamp = envutil.timestamp() as string;
  const nodecount = envutil.tdNodeCount() as number;
  const tdparts = envutil.tdParts() as number;

  const ok = setupLocally(bw, timestamp, nodecount);
  if (ok) {
    console.info("bl setup locally tstamp/nc", timestamp, nodecount);
    return true;
  }

  console.info("dowloading bl u/ts/nc/parts", url, timestamp);
  await bw.initBlocklistConstruction(
    /* rxid*/ "bl-download",
    now,
    url,
    timestamp,
    nodecount,
    tdparts
  );

  save(bw, timestamp);
}

function save(bw: any, timestamp: string) {
  if (!bw.isBlocklistFilterSetup()) return false;

  mkdirsIfNeeded(timestamp);

  const [tdfp, rdfp, ftfp] = getFilePaths(timestamp);

  // Deno only writes uint8arrays to disk, never raw arraybuffers
  Deno.writeFileSync(tdfp, new Uint8Array(bw.td));
  Deno.writeFileSync(rdfp, new Uint8Array(bw.rd));
  Deno.writeTextFileSync(ftfp, JSON.stringify(bw.ft));

  console.info("blocklists written to disk");

  return true;
}

function setupLocally(bw: any, timestamp: string, nodecount: number) {
  if (!hasBlocklistFiles(timestamp)) return false;

  const [td, rd, ft] = getFilePaths(timestamp);
  console.info("on-disk td/rd/ft", td, rd, ft);

  const tdbuf = Deno.readFileSync(td);
  const rdbuf = Deno.readFileSync(rd);
  const ftbuf = Deno.readTextFileSync(ft);

  if (tdbuf.byteLength <= 0 || rdbuf.byteLength <= 0 || ftbuf.length <= 0) {
    return false;
  }

  // TODO: file integrity checks
  // concat converts uint8array to an untyped arraybuffer
  // that blocklist-wrapper expects, because the actual
  // type required is uint16array for the trie
  const ab0 = bufutil.concat([tdbuf]);
  const ab1 = bufutil.concat([rdbuf]);
  const json1 = JSON.parse(ftbuf);
  const json2 = { nodecount: nodecount };

  bw.initBlocklistFilterConstruction(
    /* trie*/ ab0,
    /* rank-dir*/ ab1,
    /* file-tag*/ json1,
    /* basic-config*/ json2
  );

  return true;
}

function hasBlocklistFiles(timestamp: string) {
  const [td, rd, ft] = getFilePaths(timestamp);

  try {
    const tdinfo = Deno.statSync(td);
    const rdinfo = Deno.statSync(rd);
    const ftinfo = Deno.statSync(ft);

    return tdinfo.isFile && rdinfo.isFile && ftinfo.isFile;
  } catch (ignored) {}

  return false;
}

function getFilePaths(t: string) {
  const cwd = Deno.cwd();

  const td = cwd + "/" + blocklistsDir + "/" + t + "/" + tdFile;
  const rd = cwd + "/" + blocklistsDir + "/" + t + "/" + rdFile;
  const ft = cwd + "/" + blocklistsDir + "/" + t + "/" + ftFile;

  return [td, rd, ft];
}

function getDirPaths(t: string) {
  const cwd = Deno.cwd();

  const bldir = cwd + "/" + blocklistsDir;
  const tsdir = cwd + "/" + blocklistsDir + "/" + t;

  return [bldir, tsdir];
}

function mkdirsIfNeeded(timestamp: string) {
  const [dir1, dir2] = getDirPaths(timestamp);
  let dinfo1 = null;
  let dinfo2 = null;

  try {
    dinfo2 = Deno.statSync(dir1);
    dinfo1 = Deno.statSync(dir2);
  } catch (ignored) {}

  if (!dinfo1 || !dinfo1.isDirectory) {
    console.info("creating dir", dir1);
    Deno.mkdirSync(dir1);
  }

  if (!dinfo2 || !dinfo2.isDirectory) {
    console.info("creating dir", dir2);
    Deno.mkdirSync(dir2);
  }
}
