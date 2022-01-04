/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { Buffer } from "buffer";
import { DomainNameCache } from "../cache-wrapper/cache-wrapper.js";
import { customTagToFlag as _customTagToFlag } from "./radixTrie.js";
import { rbase32 } from "./b32.js";

export class BlocklistFilter {
  constructor() {
    this.t = null;
    this.ft = null;
    this.blocklistBasicConfig = null;
    this.blocklistFileTag = null;
    this.domainNameCache = null;
    // TODO: wildcard list should be fetched from S3/KV
    this.wildCardUint = new Uint16Array([
      64544, 18431, 8191, 65535, 64640, 1, 128, 16320,
    ]);
  }

  loadFilter(t, ft, blocklistBasicConfig, blocklistFileTag) {
    this.t = t;
    this.ft = ft;
    this.blocklistBasicConfig = blocklistBasicConfig;
    this.blocklistFileTag = blocklistFileTag;
    this.domainNameCache = new DomainNameCache(20000);
  }

  getDomainInfo(domainName) {
    domainName = domainName.trim().toLowerCase();
    let domainNameInfo = this.domainNameCache.get(domainName);

    if (!domainNameInfo) {
      domainNameInfo = {};
      domainNameInfo.searchResult = this.hadDomainName(domainName);
      this.domainNameCache.put(domainName, domainNameInfo);
    }

    return domainNameInfo;
  }

  hadDomainName(domainName) {
    const enc = new TextEncoder();
    return this.ft.lookup(enc.encode(domainName).reverse());
  }

  getTag(uintFlag) {
    return this.t.flagsToTag(uintFlag);
  }

  unstamp(flag) {
    return toUint(flag);
  }

  customTagToFlag(tagList) {
    return _customTagToFlag(tagList, this.blocklistFileTag);
  }

  getB64FlagFromTag(tagList, flagVersion) {
    if (flagVersion === "0") {
      return encodeURIComponent(
        Buffer.from(_customTagToFlag(tagList, this.blocklistFileTag)).toString(
          "base64"
        )
      );
    } else if (flagVersion === "1") {
      return (
        "1:" +
        encodeURI(
          btoa(encodeToBinary(_customTagToFlag(tagList, this.blocklistFileTag)))
            .replace(/\//g, "_")
            .replace(/\+/g, "-")
        )
      );
    }
  }
}

function encodeToBinary(s) {
  const codeUnits = new Uint16Array(s.length);
  for (let i = 0; i < codeUnits.length; i++) {
    codeUnits[i] = s.charCodeAt(i);
  }
  return String.fromCharCode(...new Uint8Array(codeUnits.buffer));
}

const b64delim = ":";
const b32delim = "+";

function isB32(s) {
  return s.indexOf(b32delim) > 0;
}

// s[0] is version field, if it doesn't exist
// then treat it as if version 0.
function version(s) {
  if (s && s.length > 1) return s[0];
  else return "0";
}

function toUint(flag) {
  try {
    const response = {};
    response.userBlocklistFlagUint = "";
    response.flagVersion = "0";
    // added to check if UserFlag is empty for changing dns request flow
    flag = flag ? flag.trim() : "";

    if (flag.length <= 0) {
      return response;
    }

    const isFlagB32 = isB32(flag);
    // "v:b64" or "v+b32" or "uriencoded(b64)", where v is uint version
    const s = flag.split(isFlagB32 ? b32delim : b64delim);
    let convertor = (x) => ""; // empty convertor
    let f = ""; // stamp flag
    const v = version(s);

    if (v === "0") {
      // version 0
      convertor = Base64ToUint;
      f = s[0];
    } else if (v === "1") {
      convertor = isFlagB32 ? Base32ToUintV1 : Base64ToUintV1;
      f = s[1];
    } else {
      throw new Error("unknown blocklist stamp version in " + s);
    }

    response.flagVersion = v;
    response.userBlocklistFlagUint = convertor(f) || "";

    return response;
  } catch (e) {
    throw e;
  }
}

function Base64ToUint(b64Flag) {
  const buff = Buffer.from(decodeURIComponent(b64Flag), "base64");
  const str = buff.toString("utf-8");
  const uint = [];
  for (let i = 0; i < str.length; i++) {
    uint[i] = str.charCodeAt(i);
  }
  return uint;
}

function Base64ToUintV1(b64Flag) {
  let str = decodeURI(b64Flag);
  str = decodeFromBinary(atob(str.replace(/_/g, "/").replace(/-/g, "+")));
  const uint = [];
  for (let i = 0; i < str.length; i++) {
    uint[i] = str.charCodeAt(i);
  }
  return uint;
}

function Base32ToUintV1(flag) {
  let str = decodeURI(flag);
  str = decodeFromBinaryArray(rbase32(str));
  const uint = [];
  for (let i = 0; i < str.length; i++) {
    uint[i] = str.charCodeAt(i);
  }
  return uint;
}

function decodeFromBinary(b, u8) {
  if (u8) return String.fromCharCode(...new Uint16Array(b.buffer));
  const bytes = new Uint8Array(b.length);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = b.charCodeAt(i);
  }
  return String.fromCharCode(...new Uint16Array(bytes.buffer));
}

function decodeFromBinaryArray(b) {
  const u8 = true;
  return decodeFromBinary(b, u8);
}
