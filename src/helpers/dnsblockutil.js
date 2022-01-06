/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import { Buffer } from "buffer";
import { rbase32 } from "./b32.js";
import * as util from "./util.js";

// doh uses b64url encoded blockstamp, while dot uses lowercase b32.
const _b64delim = ":";
// on DoT deployments, "-" part of flag contained in SNI is replaced with
// "+" which isn't a valid char in b64url that doh deployments use.
// ref: src/server-node.js#L224-L226 @0d217857b
const _b32delim = "+";

// TODO: wildcard list should be fetched from S3/KV
const _wildcardUint16 = new Uint16Array([
  64544, 18431, 8191, 65535, 64640, 1, 128, 16320,
]);

export function wildcards() {
  return _wildcardUint16;
}

export function isBlocklistFilterSetup(blf) {
  return blf && blf.t && blf.ft;
}

export function doBlock(blf, userBlInfo, dn, cf) {
  const blocklistMap = getBlocklistStampForDomains(dn, blf, cf);
  if (!blocklistMap) return false;

  const dnUint = blocklistMap.get(dn);
  if (!dnUint) return false;

  const r = checkFlagIntersection(
    userBlInfo.userBlocklistFlagUint,
    dnUint,
    userBlInfo.flagVersion
  );

  // if response is blocked, we're done
  if (!util.emptyObj(r) && r.isBlocked) return r;

  // if user-blockstamp doesn't contain any wildcard blocklists, we're done
  if (!userBlInfo.userServiceListUint) return r;

  // check if any subdomain is in blocklists that is also in user-blockstamp
  return checkWildcardBlocking(
    userBlInfo.userServiceListUint,
    userBlInfo.flagVersion,
    blocklistMap,
    dn
  );
}

function getBlocklistStampForDomains(domain, blf, cf) {
  if (util.emptyString(domain)) return false;

  if (!util.emptyObj(cf) && cf.hasOwnProperty(domain)) {
    return util.mapOf(cf[domain]);
  }

  if (!util.emptyObj(blf) && isBlocklistFilterSetup(blf)) {
    return blf.getDomainInfo(domain).searchResult;
  }

  return false;
}

function checkWildcardBlocking(uint1, flagVersion, blocklistMap, dn) {
  const dnSplit = dn.split(".");

  // iterate through all subdomains one by one, for ex: a.b.c.ex.com:
  // 1st: a.b.c.ex.com; 2nd: b.c.ex.com; 3rd: c.ex.com; 4th: ex.com; 5th: .com
  while (dnSplit.shift() !== undefined) {
    const subdomain = dnSplit.join(".");
    const subdomainUint = blocklistMap.get(subdomain);

    // the subdomain isn't present in any current blocklists
    if (!subdomainUint) continue;

    const response = checkFlagIntersection(uint1, subdomainUint, flagVersion);

    // if any subdomain is in any blocklist, block the current request
    if (response && response.isBlocked) {
      return response;
    }
  }

  return false;
}

function checkFlagIntersection(uint1, uint2, flagVersion) {
  const response = {
    isBlocked: false,
    blockedB64Flag: "",
  };

  const blockedUint = flagIntersection(uint1, uint2);

  if (blockedUint) {
    // incoming user-blockstamp intersects with domain-blockstamp
    response.isBlocked = true;
    response.blockedB64Flag = getB64Flag(blockedUint, flagVersion);
  } else {
    // domain-blockstamp exists but no intersection with user-blockstamp
    response.isBlocked = false;
    response.blockedB64Flag = getB64Flag(uint2, flagVersion);
  }

  return response;
}

export function flagIntersection(flag1, flag2) {
  // TODO: emptyArray or emptyString?
  if (util.emptyString(flag1) || util.emptyString(flag2)) return false;

  // flag has 16-bit header (at index 0) followed by var-length 16-bit array,
  // whose length is encoded in the header.
  let flag1Header = flag1[0];
  let flag2Header = flag2[0];

  let intersectHeader = flag1Header & flag2Header;
  if (intersectHeader === 0) {
    return false;
  }

  // length of the flag without the header,
  // its first element (at index 0)
  // since the loop is processing header's LSBs first,
  // the loop starts at len and counts down to 0.
  // ie header is in big-endian format
  let flag1Length = flag1.length - 1;
  let flag2Length = flag2.length - 1;
  const intersectBody = [];
  let tmpIntersectHeader = intersectHeader;
  let maskHeaderForBodyEmpty = 1;
  for (; tmpIntersectHeader !== 0; ) {
    // check if LSB of the intersection-header is set
    if ((tmpIntersectHeader & 0x1) === 1) {
      const tmpBodyIntersect = flag1[flag1Length] & flag2[flag2Length];
      // if there's no intersection in their bodies,
      // discard the corresponding header from the output
      if (tmpBodyIntersect === 0) {
        intersectHeader = intersectHeader ^ maskHeaderForBodyEmpty;
      } else {
        intersectBody.push(tmpBodyIntersect);
      }
    }

    if ((flag1Header & 1) === 1) {
      flag1Length -= 1;
    }
    if ((flag2Header & 1) === 1) {
      flag2Length -= 1;
    }

    // next header-bit, remove the LSB bit already processed
    flag1Header >>>= 1;
    flag2Header >>>= 1;
    tmpIntersectHeader >>>= 1;

    // tracks the header bit index to be reset in case bodies do not intersect
    maskHeaderForBodyEmpty <<= 1;
  }

  if (intersectHeader === 0) {
    return false;
  }

  const out = new Uint16Array(/* header*/ 1 + intersectBody.length);
  // always set the header at index 0
  out.set([intersectHeader], 0);
  // set the body starting at index 1
  out.set(intersectBody, 1);

  return out;
}

function getB64Flag(uint16Arr, flagVersion) {
  if (util.emptyArray(uint16Arr)) return "";

  if (flagVersion === "0") {
    return encodeURIComponent(Buffer.from(uint16Arr).toString("base64"));
  } else if (flagVersion === "1") {
    const flag = encodeURI(bytesToBase64Url(uint16Arr.buffer));
    return flagVersion + ":" + flag;
  }
}

export function bytesToBase64Url(b) {
  return btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\//g, "_")
    .replace(/\+/g, "-")
    .replace(/=/g, "");
}

/**
 * Get the blocklist flag from `Request` URL
 * DNS over TLS flag from SNI should be rewritten to `url`'s pathname
 * @param {String} url - Request URL string
 * @returns
 */
export function blockstampFromUrl(u) {
  const url = new URL(u);

  const paths = url.pathname.split("/");
  if (paths.length <= 1) {
    return "";
  }
  // skip to next if path has `/dns-query`
  if (paths[1].toLowerCase() === "dns-query") {
    return paths[2] || "";
  } else {
    return paths[1] || "";
  }
}

export function binaryStringToBytes(bs) {
  const len = bs.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = bs.charCodeAt(i);
  }
  return bytes;
}

export function regularBase64(b64url) {
  if (util.emptyString(b64url)) return b64url;

  return b64url.replace(/_/g, "/").replace(/-/g, "+");
}

export function base64ToUintV0(b64Flag) {
  const buff = Buffer.from(decodeURIComponent(b64Flag), "base64");
  const str = buff.toString("utf-8");
  const uint = [];
  for (let i = 0; i < str.length; i++) {
    uint[i] = str.charCodeAt(i);
  }
  return uint;
}

export function base64ToUint8(b64uri) {
  const b64url = decodeURI(b64uri);
  const binaryStr = atob(regularBase64(b64url));
  return binaryStringToBytes(binaryStr);
}

export function base64ToUint16(b64uri) {
  const b64url = decodeURI(b64uri);
  const binaryStr = atob(regularBase64(b64url));
  return decodeFromBinary(binaryStr);
}

export function base64ToUintV1(b64Flag) {
  return base64ToUint16(b64Flag);
}

export function base64ToBytes(b64uri) {
  return base64ToUint8(b64uri).buffer;
}

export function base32ToUintV1(flag) {
  const b32 = decodeURI(flag);
  return decodeFromBinaryArray(rbase32(b32));
}

export function decodeFromBinary(b, u8) {
  // if b is a u8 array, simply u16 it
  if (u8) return new Uint16Array(b.buffer);

  // if b is a binary-string, convert it to u8
  const bytes = binaryStringToBytes(b);
  // ...and then to u16
  return new Uint16Array(bytes.buffer);
}

export function decodeFromBinaryArray(b) {
  const u8 = true;
  return decodeFromBinary(b, u8);
}

export function isB32Stamp(s) {
  return s.indexOf(_b32delim) > 0;
}

// s[0] is version field, if it doesn't exist
// then treat it as if version 0.
export function stampVersion(s) {
  if (s && s.length > 1) return s[0];
  else return "0";
}

// TODO: The logic to parse stamps must be kept in sync with:
// github.com/celzero/website-dns/blob/8e6056bb/src/js/flag.js#L260-L425
export function unstamp(flag) {
  const response = {};
  response.userBlocklistFlagUint = "";
  response.flagVersion = "0";
  // added to check if UserFlag is empty for changing dns request flow
  flag = flag ? flag.trim() : "";

  if (flag.length <= 0) {
    return response;
  }

  const isFlagB32 = isB32Stamp(flag);
  // "v:b64" or "v+b32" or "uriencoded(b64)", where v is uint version
  const s = flag.split(isFlagB32 ? _b32delim : _b64delim);
  let convertor = (x) => ""; // empty convertor
  let f = ""; // stamp flag
  const v = stampVersion(s);

  if (v === "0") {
    // version 0
    convertor = base64ToUintV0;
    f = s[0];
  } else if (v === "1") {
    convertor = isFlagB32 ? base32ToUintV1 : base64ToUintV1;
    f = s[1];
  } else {
    throw new Error("unknown blocklist stamp version in " + s);
  }

  response.flagVersion = v;
  response.userBlocklistFlagUint = convertor(f) || "";

  return response;
}
