/*
 * Copyright (c) 2022 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as util from "../../commons/util.js";
import * as bufutil from "../../commons/bufutil.js";
import * as envutil from "../../commons/envutil.js";
import { LogPusher } from "../../plugins/observability/log-pusher.js";

const dbipDir = "./dbip__";
const geo4name = "dbip.v4";
const geo6name = "dbip.v6";

export async function setup(lp: LogPusher) {
  if (!lp) return false;
  // in download only mode, logpush enable/disable is ignored
  if (!envutil.logpushEnabled() && !envutil.blocklistDownloadOnly()) {
    return false;
  }

  const url: string = envutil.geoipUrl();
  const timestamp: string = timestampFromUrl(url);

  const ok = setupLocally(lp, timestamp);
  if (ok) {
    console.info("dbip setup locally", timestamp);
    return true;
  }

  await lp.init();

  return save(lp, timestamp);
}

function timestampFromUrl(url: string) {
  if (util.emptyString(url)) throw new Error("empty geo url: " + url);

  const parts = url.split("/");
  const p1 = parts[parts.length - 1];
  const p2 = parts[parts.length - 2];
  const p = p1 || p2;
  const ts = parseInt(p);
  if (!isNaN(ts) && typeof ts === "number") return p;

  throw new Error("invalid timestamp in: " + url);
}

function save(lp: LogPusher, timestamp: string) {
  if (!lp.initDone()) return false;

  mkdirsIfNeeded(timestamp);

  const [g4fp, g6fp] = getFilePaths(timestamp);

  const g4 = lp.geo4();
  const g6 = lp.geo6();
  // write out array-buffers to disk
  g4 && Deno.writeFileSync(g4fp, g4);
  g6 && Deno.writeFileSync(g6fp, g6);

  console.info("dbip written to disk (g4/g6)", g4?.byteLength, g6?.byteLength);

  return true;
}

function setupLocally(lp: LogPusher, timestamp: string) {
  const ok = hasDbipFiles(timestamp);
  console.info(timestamp, "has dbip files?", ok);
  if (!ok) return false;

  const [g4, g6] = getFilePaths(timestamp);
  console.info("on-disk dbip v4/v6", g4, g6);

  const g4buf = Deno.readFileSync(g4);
  const g6buf = Deno.readFileSync(g6);

  // TODO: file integrity checks
  const ab0 = bufutil.raw(g4buf);
  const ab1 = bufutil.raw(g6buf);

  lp.init(ab0, ab1);

  return true;
}

function hasDbipFiles(timestamp: string) {
  if (!envutil.hasDisk()) return false;

  const [g4fp, g6fp] = getFilePaths(timestamp);

  try {
    const g4ent = Deno.statSync(g4fp);
    const g6ent = Deno.statSync(g6fp);

    return g4ent.isFile && g6ent.isFile;
  } catch (ignored) {}

  return false;
}

function getFilePaths(t: string) {
  const g4fp = dbipDir + "/" + t + "/" + geo4name;
  const g6fp = dbipDir + "/" + t + "/" + geo6name;

  return [g4fp, g6fp];
}

function getDirPaths(t: string) {
  const cwd = Deno.cwd();

  const dbdir = cwd + "/" + dbipDir;
  const tsdir = cwd + "/" + dbipDir + "/" + t;

  return [dbdir, tsdir];
}

function mkdirsIfNeeded(timestamp: string) {
  const opts = { recursive: true };
  const [dir1, dir2] = getDirPaths(timestamp);

  let dinfo1 = null;
  let dinfo2 = null;
  try {
    dinfo1 = Deno.statSync(dir1);
    dinfo2 = Deno.statSync(dir2);
  } catch (ignored) {}

  if (!dinfo1 || !dinfo1.isDirectory) {
    console.info("creating dbip dir", dir1);
    Deno.mkdirSync(dir1, opts);
  }

  if (!dinfo2 || !dinfo2.isDirectory) {
    console.info("creating timestamp dir", dir2);
    Deno.mkdirSync(dir2, opts);
  }
}
