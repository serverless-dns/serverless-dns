/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import { rbase32 } from "../commons/b32.js";
import * as util from "../commons/util.js";
import * as bufutil from "../commons/bufutil.js";
import * as dnsutil from "../commons/dnsutil.js";

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
  return blf && !util.emptyObj(blf.t) && !util.emptyObj(blf.ft);
}

export function dnsResponse(packet = null, raw = null, stamps = null) {
  if (util.emptyObj(packet) || bufutil.emptyBuf(raw)) {
    throw new Error("empty packet for dns-res");
  }
  return {
    isBlocked: false,
    flag: "",
    dnsPacket: packet,
    dnsBuffer: raw,
    stamps: stamps || {},
  };
}

export function copyOnlyBlockProperties(to, from) {
  to.isBlocked = from.isBlocked;
  to.flag = from.flag;

  return to;
}

export function rdnsNoBlockResponse(
  flag = "",
  packet = null,
  raw = null,
  stamps = null
) {
  return {
    isBlocked: false,
    flag: flag || "",
    dnsPacket: packet,
    dnsBuffer: raw,
    stamps: stamps || {},
  };
}

export function rdnsBlockResponse(
  flag,
  packet = null,
  raw = null,
  stamps = null
) {
  if (util.emptyString(flag)) {
    throw new Error("no flag set for block-res");
  }
  return {
    isBlocked: true,
    flag: flag,
    dnsPacket: packet,
    dnsBuffer: raw,
    stamps: stamps || {},
  };
}

// dn         -> domain name, ex: you.and.i.example.com
// userBlInfo -> user-selected blocklist-stamp
//               {userBlocklistFlagUint, userServiceListUint}
// dnBlInfo   -> obj of blocklists stamps for dn and all its subdomains
//               {string(sub/domain-name) : string(blocklist-stamp) }
export function doBlock(dn, userBlInfo, dnBlInfo) {
  const noblock = rdnsNoBlockResponse();
  if (
    util.emptyString(dn) ||
    util.emptyObj(dnBlInfo) ||
    util.emptyObj(userBlInfo)
  ) {
    return noblock;
  }

  const dnUint = new Uint16Array(dnBlInfo[dn]);

  if (util.emptyArray(dnUint)) return noblock;

  const r = applyBlocklists(
    userBlInfo.userBlocklistFlagUint,
    dnUint,
    userBlInfo.flagVersion
  );

  // if response is blocked, we're done
  if (r.isBlocked) return r;

  // TODO: treat every list as a wildcard list?
  // if user-blockstamp doesn't contain any wildcard blocklists, we're done
  if (util.emptyArray(userBlInfo.userServiceListUint)) return r;

  // check if any subdomain is in blocklists that is also in user-blockstamp
  return applyWildcardBlocklists(
    userBlInfo.userServiceListUint,
    userBlInfo.flagVersion,
    dnBlInfo,
    dn
  );
}

export function blockstampFromCache(cr) {
  const p = cr.dnsPacket;
  const m = cr.metadata;

  if (util.emptyObj(p) || util.emptyObj(m)) return false;

  return m.stamps;
}

export function blockstampFromBlocklistFilter(dnsPacket, blocklistFilter) {
  if (util.emptyObj(dnsPacket)) return false;
  if (!isBlocklistFilterSetup(blocklistFilter)) return false;

  const domains = dnsutil.extractDomains(dnsPacket);

  if (util.emptyArray(domains)) return false;

  const m = new Map();
  for (const n of domains) {
    // may return Map(domain, b64stamp) or false
    const stamp = blocklistFilter.blockstamp(n);

    if (util.emptyMap(stamp)) continue;

    for (const [k, v] of stamp) m.set(k, v);
  }
  // note: stamps must be objs, ref plugin.js "domainBlockstamp"
  return util.emptyMap(m) ? false : util.objOf(m);
}

function applyWildcardBlocklists(uint1, flagVersion, dnBlInfo, dn) {
  const dnSplit = dn.split(".");

  // iterate through all subdomains one by one, for ex: a.b.c.ex.com:
  // 1st: a.b.c.ex.com; 2nd: b.c.ex.com; 3rd: c.ex.com; 4th: ex.com; 5th: .com
  while (dnSplit.shift() !== undefined) {
    const subdomain = dnSplit.join(".");
    const subdomainUint = dnBlInfo[subdomain];

    // the subdomain isn't present in any current blocklists
    if (util.emptyArray(subdomainUint)) continue;

    const response = applyBlocklists(uint1, subdomainUint, flagVersion);

    // if any subdomain is in any blocklist, block the current request
    if (!util.emptyObj(response) && response.isBlocked) {
      return response;
    }
  }

  return rdnsNoBlockResponse();
}

function applyBlocklists(uint1, uint2, flagVersion) {
  // uint1 -> user blocklists; uint2 -> blocklists including sub/domains
  const blockedUint = intersect(uint1, uint2);

  if (blockedUint) {
    // incoming user-blockstamp intersects with domain-blockstamp
    return rdnsBlockResponse(getB64Flag(blockedUint, flagVersion));
  } else {
    // domain-blockstamp exists but no intersection with user-blockstamp
    return rdnsNoBlockResponse(getB64Flag(uint2, flagVersion));
  }
}

function intersect(flag1, flag2) {
  if (util.emptyArray(flag1) || util.emptyArray(flag2)) return null;

  // flag has 16-bit header (at index 0) followed by var-length 16-bit array,
  // whose length is encoded in the header.
  let header1 = flag1[0];
  let header2 = flag2[0];

  let commonHeader = header1 & header2;
  if (commonHeader === 0) {
    return null;
  }

  // length of the flag without the header, its first element (at index 0)
  // since the loop is processing header's LSBs first, the loop starts at
  // len and counts down to 0, ie header is in big-endian format.
  let i = flag1.length - 1;
  let j = flag2.length - 1;
  let h = commonHeader;
  let pos = 0;
  const commonBody = [];
  while (h !== 0) {
    if (i < 0 || j < 0) throw new Error("blockstamp header/body mismatch");

    // check if LSB of the intersection-header is set
    if ((h & 0x1) === 1) {
      const commonFlags = flag1[i] & flag2[j];
      // if there's no intersection in their bodies,
      // discard the corresponding header from the output
      if (commonFlags === 0) {
        commonHeader = clearbit(commonHeader, pos);
      } else {
        commonBody.push(commonFlags);
      }
    }

    if ((header1 & 0x1) === 1) {
      i -= 1;
    }
    if ((header2 & 0x1) === 1) {
      j -= 1;
    }

    // next header-bit, remove the LSB bit already processed
    header1 >>>= 1;
    header2 >>>= 1;
    h >>>= 1;
    pos += 1;
  }

  if (commonHeader === 0) {
    return null;
  }

  // intersectBody is reversed, as in, MSB positions are in LSB.
  // intersectHeader is already setup in the expected order.
  return Uint16Array.of(commonHeader, ...commonBody.reverse());
}

function clearbit(uint, pos) {
  return uint & ~(1 << pos);
}

export function getB64Flag(uint16Arr, flagVersion) {
  if (util.emptyArray(uint16Arr)) return "";

  const b64url = bufutil.bytesToBase64Url(uint16Arr.buffer);
  if (flagVersion === "0") {
    return encodeURIComponent(b64url);
  } else if (flagVersion === "1") {
    const flag = encodeURI(b64url);
    return flagVersion + ":" + flag;
  } else {
    throw new Error("unsupported flag version" + flagVersion);
  }
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
  // TODO: check if paths[1|2] is a valid stamp
  // skip to next if path has `/dns-query`
  if (paths[1].toLowerCase() === "dns-query") {
    return paths[2] || "";
  } else {
    return paths[1] || "";
  }
}

export function base64ToUintV0(b64Flag) {
  // TODO: v0 not in use, remove all occurences
  // FIXME: Impl not accurate
  // celzero/website-dns/blob/7b3a74185/src/js/flag.js#L117
  const f = decodeURIComponent(b64Flag);
  return bufutil.base64ToUint16(f);
}

export function base64ToUintV1(b64Flag) {
  // TODO: check for empty b64Flag
  return bufutil.base64ToUint16(b64Flag);
}

export function base32ToUintV1(flag) {
  // TODO: check for empty flag
  const b32 = decodeURI(flag);
  return bufutil.decodeFromBinaryArray(rbase32(b32));
}

export function isB32Stamp(s) {
  return s.indexOf(_b32delim) > 0;
}

// s[0] is version field, if it doesn't exist
// then treat it as if version 0.
export function stampVersion(s) {
  if (!util.emptyArray(s)) return s[0];
  else return "0";
}

// TODO: The logic to parse stamps must be kept in sync with:
// github.com/celzero/website-dns/blob/8e6056bb/src/js/flag.js#L260-L425
export function unstamp(flag) {
  const r = {
    userBlocklistFlagUint: null,
    flagVersion: "0",
    userServiceListUint: null,
  };

  if (util.emptyString(flag)) return r;

  // added to check if UserFlag is empty for changing dns request flow
  flag = flag.trim();

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
    log.w("Rdns:unstamp", "unknown blocklist stamp version in " + s);
    return r;
  }

  r.flagVersion = v;
  r.userBlocklistFlagUint = convertor(f) || null;
  r.userServiceListUint = intersect(r.userBlocklistFlagUint, _wildcardUint16);

  return r;
}

export function hasBlockstamp(blockInfo) {
  return (
    !util.emptyObj(blockInfo) &&
    !util.emptyArray(blockInfo.userBlocklistFlagUint)
  );
}
