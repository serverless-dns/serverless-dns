/*
 * Copyright (c) 2022 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as bufutil from "../../commons/bufutil.js";
import * as envutil from "../../commons/envutil.js";
import * as util from "../../commons/util.js";
import { LogPusher } from "../../plugins/observability/log-pusher.js";
import { log } from "../log.js";

const dbipDir = "./dbip__";
const geo4name = "dbip.v4";
const geo6name = "dbip.v6";

/** @param {LogPusher} lp */
export async function setup(lp) {
  if (!lp) return false;
  // in download only mode, logpush enable/disable is ignored
  if (!envutil.logpushEnabled() && !envutil.blocklistDownloadOnly()) {
    return false;
  }
  const url = envutil.geoipUrl();
  const timestamp = timestampFromUrl(url);

  const ok = setupLocally(lp, timestamp);
  if (ok) {
    log.i("dbip setup locally", timestamp);
    return true;
  }

  await lp.init();

  return save(lp, timestamp);
}

function timestampFromUrl(url) {
  if (util.emptyString(url)) throw new Error("empty geo url: " + url);

  const parts = url.split("/");
  const p1 = parts[parts.length - 1];
  const p2 = parts[parts.length - 2];
  const p = p1 || p2;
  const ts = parseInt(p);
  if (!isNaN(ts) && typeof ts === "number") return p;

  throw new Error("invalid timestamp in: " + url);
}

/**
 * @param {LogPusher} lp
 * @param {string} timestamp
 * @returns {boolean}
 */
function save(lp, timestamp) {
  if (!lp.initDone()) return false;

  mkdirsIfNeeded(timestamp);

  const [g4fp, g6fp] = getFilePaths(timestamp);

  const g4 = lp.geo4();
  const g6 = lp.geo6();
  // write out array-buffers to disk
  fs.writeFileSync(g4fp, bufutil.bufferOf(g4));
  fs.writeFileSync(g6fp, bufutil.bufferOf(g6));

  log.i("dbip written to disk (g4/g6)", g4.byteLength, g6.byteLength);

  return true;
}

function setupLocally(lp, timestamp) {
  const ok = hasDbipFiles(timestamp);
  log.i(timestamp, "has dbip files?", ok);
  if (!ok) return false;

  const [g4, g6] = getFilePaths(timestamp);
  log.i("on-disk dbip v4/v6", g4, g6);

  const g4buf = fs.readFileSync(g4);
  const g6buf = fs.readFileSync(g6);

  // TODO: file integrity checks
  const ab0 = bufutil.raw(g4buf);
  const ab1 = bufutil.raw(g6buf);

  lp.init(ab0, ab1);

  return true;
}

function hasDbipFiles(timestamp) {
  if (!envutil.hasDisk()) return false;

  const [g4, g6] = getFilePaths(timestamp);
  return fs.existsSync(g4) && fs.existsSync(g6);
}

function getFilePaths(t) {
  const g4 = dbipDir + "/" + t + "/" + geo4name;
  const g6 = dbipDir + "/" + t + "/" + geo6name;

  return [path.normalize(g4), path.normalize(g6)];
}

function getDirPaths(t) {
  const dbdir = path.normalize(dbipDir);
  const tsdir = path.normalize(dbipDir + "/" + t);

  return [dbdir, tsdir];
}

function mkdirsIfNeeded(timestamp) {
  const opts = { recursive: true };
  const [dir1, dir2] = getDirPaths(timestamp);

  if (!fs.existsSync(dir1)) {
    log.i("creating dbip dir", dir1);
    fs.mkdirSync(dir1, opts);
  }

  if (!fs.existsSync(dir2)) {
    log.i("creating timestamp dir", dir2);
    fs.mkdirSync(dir2, opts);
  }
}
