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
const bcFile = "basicconfig.json";
const ftFile = "filetag.json";

export async function setup(bw: BlocklistWrapper) {
  if (!bw || !envutil.hasDisk()) return false;

  const ok = setupLocally(bw);
  if (ok) {
    return true;
  }

  console.info("dowloading blocklists");
  await bw.init(/* rxid*/ "bl-download", /* wait */ true);

  return save(bw);
}

function save(bw: BlocklistWrapper) {
  if (!bw.isBlocklistFilterSetup()) return false;

  const timestamp = bw.timestamp();
  const codec = bw.codec();

  mkdirsIfNeeded(timestamp, codec);

  const [tdfp, rdfp, bcfp, ftfp] = getFilePaths(timestamp, codec);

  const td = bw.triedata();
  const rd = bw.rankdata();
  const bc = bw.basicconfig();
  const ft = bw.filetag();
  // Deno only writes uint8arrays to disk, never raw arraybuffers
  Deno.writeFileSync(tdfp, new Uint8Array(td));
  Deno.writeFileSync(rdfp, new Uint8Array(rd));
  // write the basic config and file tag as json; may overwrite existing
  Deno.writeTextFileSync(bcfp, JSON.stringify(bc));
  Deno.writeTextFileSync(ftfp, JSON.stringify(ft));

  console.info("blocklist files written to disk", tdfp, rdfp, bcfp, ftfp);

  return true;
}

/**
 * Loads the blocklist files & configuration from disk, if any.
 * TODO: return false if blocklists age > AUTO_RENEW_BLOCKLISTS_OLDER_THAN
 */
function setupLocally(bw: BlocklistWrapper) {
  const ts = cfg.timestamp() as string;
  const tdcodec6 = cfg.tdCodec6() as boolean;
  const codec = tdcodec6 ? "u6" : "u8";

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
  } catch (_) {
    /* no-op */
  }

  return false;
}

/**
 * Returns the file paths for the blocklists.
 * @returns {string[]} [td, rd, bc, ft]
 */
function getFilePaths(t: string, c: string): string[] {
  const cwd = Deno.cwd();

  const td = cwd + "/" + blocklistsDir + "/" + t + "/" + c + "/" + tdFile;
  const rd = cwd + "/" + blocklistsDir + "/" + t + "/" + c + "/" + rdFile;
  const bc = cwd + "/" + c + "-" + bcFile;
  const ft = cwd + "/" + c + "-" + ftFile;

  return [td, rd, bc, ft];
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
  } catch (_) {
    /* no-op */
  }

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
