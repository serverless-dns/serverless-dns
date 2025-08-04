/**
 * @fileoverview Prefetcher for remote blocklists using built-in Node.js 20+ fetch API.
 * @module prefetcher
 */

import * as envutil from "../../commons/envutil.js";
import * as util from "../../commons/util.js";

const BASE_URL = envutil.blocklistUrl();
const DIR = "bc";
const CODEC = "u6";
const FILE_BASIC_CONFIG = "basicconfig.json";
const FILE_TAG = "filetag.json";
const MAX_RETRIES = 5;

/**
 * @typedef {Object} DateInfo
 * @property {number} day
 * @property {number} week
 * @property {number} month
 * @property {number} year
 * @property {number} timestamp
 */

/**
 * Get the current UTC timestamp in secs.
 * @returns {number}
 */
function currentEpoch() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Get date details from a timestamp.
 * @param {number} timestamp
 * @returns {DateInfo}
 */
function getDateInfo(timestamp) {
  const date = new Date(timestamp * 1000);
  const day = date.getUTCDate();
  const week = Math.ceil(day / 7);
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  return { day, week, month, year, timestamp };
}

/**
 * Main function to prefetch files based on week, month, and year.
 */
async function prefetch(codec = CODEC) {
  const now = currentEpoch();
  const { week: wk, month: mm, year: yyyy } = getDateInfo(now);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const configUrl = `${BASE_URL}/${yyyy}/${DIR}/${mm}-${wk}/${codec}/${FILE_BASIC_CONFIG}`;
    log.i(`attempt ${attempt}: fetching ${configUrl} at ${now}`);

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
      const fullTimestamp = util.bareTimestampFrom(bconfig.timestamp);
      if (fullTimestamp) {
        const tagUrl = `${BASE_URL}/${fullTimestamp}/${codec}/${FILE_TAG}`;
        log.d(`attempt ${attempt}: fetching ${configUrl} at ${now}`);
        const ft = await fetchFile(tagUrl, "json");
        if (ft) return [bconfig, ft];
        else log.w(`failed to fetch ${tagUrl}`);
      }
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
