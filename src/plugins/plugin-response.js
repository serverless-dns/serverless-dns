/*
 * Copyright (c) 2022 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as util from "../commons/util.js";
import * as bufutil from "../commons/bufutil.js";

/** @typedef {import("./users/auth-token.js").Outcome} AuthOutcome */

export class RResp {
  constructor(data = null, hasex = false, exfrom = "", exstack = "") {
    /** @type {RespData?} */
    this.data = data || new RespData();
    /** @type {boolean} */
    this.isException = hasex;
    /** @type {String} */
    this.exceptionFrom = exfrom;
    /** @type {String} */
    this.exceptionStack = exstack;
  }
}

export class RespData {
  constructor(blocked = false, flag, packet, raw, stamps) {
    /** @type {boolean} */
    this.isBlocked = blocked;
    /** @type {String} */
    this.flag = flag || "";
    /** @type {Object} */
    this.dnsPacket = packet || null;
    /** @type {ArrayBuffer?} */
    this.dnsBuffer = raw || null;
    /** @type {BStamp|boolean} */
    this.stamps = stamps || {};
    /** @type {AuthOutcome?} */
    this.userAuth = null;
    /** @type {BlockstampInfo?} */
    this.userBlocklistInfo = null;
    /** @type {String} */
    this.dnsResolverUrl = "";
    /** @type {string} */
    this.userBlocklistFlag = "";
  }
}

export class BlockstampInfo {
  constructor() {
    /** @type {Uint16Array} */
    this.userBlocklistFlagUint = null;
    /** @type {String} - mosty 0 or 1 */
    this.flagVersion = "0";
  }
}

/**
 * @typedef {Object.<string, Uint16Array>} BStamp
 */

/** @returns {RResp} */
export function emptyResponse() {
  return new RResp();
}

/**
 * @param {String} id
 * @param {Error} err
 * @returns {RResp}
 */
export function errResponse(id, err) {
  const data = null;
  const hasex = true;
  const st = util.emptyObj(err) || !err.stack ? "no-stacktrace" : err.stack;
  return new RResp(data, hasex, id, st);
}

/**
 * @param {Object} packet
 * @param {ArrayBuffer} raw
 * @param {BStamp?} stamps
 * @returns {RespData}
 */
export function dnsResponse(packet = null, raw = null, stamps = null) {
  if (util.emptyObj(packet) || bufutil.emptyBuf(raw)) {
    throw new Error("empty packet for dns-res");
  }
  const flags = "";
  const blocked = false;
  return new RespData(blocked, flags, packet, raw, stamps);
}

/**
 * @param {String} flag
 * @returns {RespData}
 */
export function rdnsBlockResponse(flag) {
  if (util.emptyString(flag)) {
    throw new Error("no flag set for block-res");
  }
  const blocked = true;
  return new RespData(blocked, flag);
}

/** @returns {RespData} */
export function rdnsNoBlockResponse() {
  return new RespData(false);
}

/**
 * Copy block related props from one RespData to another
 * @param {RespData} to
 * @param {RespData} from
 * @returns {RespData} to
 */
export function copyOnlyBlockProperties(to, from) {
  to.isBlocked = from.isBlocked;
  to.flag = from.flag;

  return to;
}
