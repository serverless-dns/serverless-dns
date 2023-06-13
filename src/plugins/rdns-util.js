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
import * as envutil from "../commons/envutil.js";
import * as pres from "./plugin-response.js";
import * as trie from "@serverless-dns/trie/stamp.js";
import { BlocklistFilter } from "./rethinkdns/filter.js";
import { DnsCacheData } from "./cache-util.js";

// doh uses b64url encoded blockstamp, while dot uses lowercase b32.
const _b64delim = ":";
const _b32delim = "-";
// begins with l, followed by b64delim or b32delim
export const logPrefix = new RegExp(`^l${_b64delim}|^l${_b32delim}`);
// begins with a digit, followed by b64delim or b32delim
export const stampPrefix = new RegExp(`^\\d+${_b64delim}|^\\d+${_b32delim}`);

const emptystr = "";
// delim, version, blockstamp (flag), accesskey
const emptystamp = [emptystr, emptystr, emptystr, emptystr];

// deprecated: all lists are trreated as wildcards
const _wildcardUint16 = new Uint16Array([
  64544, 18431, 8191, 65535, 64640, 1, 128, 16320,
]);

// pec: parental control, rec: recommended, sec: security
const recBlockstamps = new Map();
// oisd, 1hosts:mini, cpbl:light, anudeep, yhosts, tiuxo, adguard
recBlockstamps.set("rec", "1:YAYBACABEDAgAA==");
// nocoin, malware (url haus), security (stevenblack), kadhosts (polish), inversion,
// spam404, notrack (malware), baddboyz (michael krogza), malware (michael krogza),
// malware (rpi), threats (hagezi), malware (oblat), phishing (oblat), red flag domains,
// malware (dandelion), blackbook, scams (infinitec), malware (rescure), nso (amnesty),
// global anti-scam (inversion), scamware (shadowwhisperer), covid list (rescure),
// cryptojacking (tblp), ransomware (tblp), threats (osint)
recBlockstamps.set("sec", "1:EBx5AqvtyDcAKA==");
// prevent bypass, safe search, dating (olbat), gambling (olbat), gambling (hostvn),
// gambling (sinfonietta), adult (tuixo), adult (stevenblack), nsfw (oisd),
// drugs (tblp), vaping (tblp), adult (tblp), 1hosts (kidsaf), vaping (tblp),
// nsfl (shadowwhisperer), adult (shadowwhisperer)
recBlockstamps.set("pec", "1:GMAB-ACgYVIAgA==");
// rec, sec
recBlockstamps.set("rs", "1:cB55AqvtyTcgARAwIAAAKA==");
// pec, rec, sec
recBlockstamps.set("prs", "1:eN4B-ACgeQKr7ck3IAEQMCAAYXoAgA==");
// pec, rec
recBlockstamps.set("pr", "1:eMYB-ACgAQAgARAwIABhUgCA");
// pec, sec
recBlockstamps.set("ps", "1:GNwB-ACgeQKr7cg3YXoAgA==");

export function isBlocklistFilterSetup(blf) {
  return blf && !util.emptyObj(blf.ftrie);
}

export function isStampQuery(p) {
  return stampPrefix.test(p);
}

export function isLogQuery(p) {
  return logPrefix.test(p);
}

// dn         -> domain name, ex: you.and.i.example.com
// userBlInfo -> user-selected blocklist-stamp
//               {userBlocklistFlagUint, userServiceListUint}
// dnBlInfo   -> obj of blocklists stamps for dn and all its subdomains
//               {string(sub/domain-name) : u16(blocklist-stamp) }
// FIXME: return block-dnspacket depending on altsvc/https/svcb or cname/a/aaaa
export function doBlock(dn, userBlInfo, dnBlInfo) {
  const blockSubdomains = envutil.blockSubdomains();
  const version = userBlInfo.flagVersion;
  const noblock = pres.rdnsNoBlockResponse();
  if (
    util.emptyString(dn) ||
    util.emptyObj(dnBlInfo) ||
    util.emptyObj(userBlInfo)
  ) {
    return noblock;
  }

  // treat every blocklist as a wildcard blocklist
  if (blockSubdomains) {
    return applyWildcardBlocklists(
      userBlInfo.userBlocklistFlagUint,
      version,
      dnBlInfo,
      dn
    );
  }

  const dnUint = new Uint16Array(dnBlInfo[dn]);
  // if the domain isn't in block-info, we're done
  if (util.emptyArray(dnUint)) return noblock;
  // else, determine if user selected blocklist intersect with the domain's
  const r = applyBlocklists(userBlInfo.userBlocklistFlagUint, dnUint, version);

  // if response is blocked, we're done
  if (r.isBlocked) return r;
  // if user-blockstamp doesn't contain any wildcard blocklists, we're done
  if (util.emptyArray(userBlInfo.userServiceListUint)) return r;

  // check if any subdomain is in blocklists that is also in user-blockstamp
  return applyWildcardBlocklists(
    userBlInfo.userServiceListUint,
    version,
    dnBlInfo,
    dn
  );
}

/**
 * @param {DnsCacheData} cr
 * @returns {pres.BStamp|boolean}
 */
export function blockstampFromCache(cr) {
  const p = cr.dnsPacket;
  const m = cr.metadata;

  if (util.emptyObj(p) || util.emptyObj(m)) return false;

  return m.stamps;
}

/**
 * @param {*} dnsPacket
 * @param {BlocklistFilter} blocklistFilter
 * @returns {pres.BStamp|boolean}
 */
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
  do {
    if (util.emptyArray(dnSplit)) break;

    const subdomain = dnSplit.join(".");
    const subdomainUint = dnBlInfo[subdomain];

    // the subdomain isn't present in any current blocklists
    if (util.emptyArray(subdomainUint)) continue;

    const response = applyBlocklists(uint1, subdomainUint, flagVersion);

    // if any subdomain is in any blocklist, block the current request
    if (!util.emptyObj(response) && response.isBlocked) {
      return response;
    }
  } while (dnSplit.shift() != null);

  return pres.rdnsNoBlockResponse();
}

function applyBlocklists(uint1, uint2, flagVersion) {
  // uint1 -> user blocklists; uint2 -> blocklists including sub/domains
  const blockedUint = intersect(uint1, uint2);

  if (blockedUint) {
    // incoming user-blockstamp intersects with domain-blockstamp
    return pres.rdnsBlockResponse(getB64Flag(blockedUint, flagVersion));
  } else {
    // domain-blockstamp exists but no intersection with user-blockstamp
    return pres.rdnsNoBlockResponse(getB64Flag(uint2, flagVersion));
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
 * Get msg key from `Request` URL
 * @param {string} u
 * @returns {string} k
 */
export function msgkeyFromUrl(u) {
  const ans = extractStamps(u);
  // accesskey is at index 3
  return ans[3] || "";
}

/**
 * Get the blocklist flag from `Request` URL
 * DNS over TLS flag from SNI is yanked into `url`'s pathname
 * @param {string} u
 * @returns {string}
 */
export function blockstampFromUrl(u) {
  const ans = extractStamps(u);
  const delim = ans[0];
  const ver = ans[1] || ""; // may be undefined
  const blockstamp = ans[2] || ""; // may be undefined

  // delim at index 0, version at index 1, blockstamp at index 2
  if (util.emptyString(ver) || util.emptyString(blockstamp)) return "";

  return ver + delim + blockstamp;
}

/**
 * @param {URL} url
 * @returns {String} stampvalue
 */
export function recBlockstampFrom(url) {
  // is the incoming request to the legacy free.bravedns.com endpoint?
  const isFreeBraveDns = url.hostname.includes("free.bravedns");
  if (isFreeBraveDns) return "rec";

  for (const [k, v] of recBlockstamps) {
    // does incoming request have a rec in its path? (DoH)
    if (
      url.pathname.includes("/" + k + "/") ||
      url.pathname.endsWith("/" + k)
    ) {
      return v;
    }
    // does incoming request have a rec in its hostname? (DoT)
    if (url.hostname.startsWith(k + ".")) return v;
  }

  return "";
}

/**
 * @param {string} u - Request URL string
 * @returns {Array<string>} s - delim, version, blockstamp (flag), accesskey
 */
export function extractStamps(u) {
  const url = new URL(u);
  const recStamp = recBlockstampFrom(url);
  const useRecStamp = !util.emptyString(recStamp);

  let s = emptystr;
  // note: the legacy free.bravedns endpoint need not support
  // gateway queries or auth
  if (useRecStamp) {
    s = recStamp;
  }

  const paths = url.pathname.split("/");
  const domains = url.hostname.split(".");
  // could be a b32 flag in the hostname,
  // even if its a http-req (possible for a cc request)
  for (const d of domains) {
    if (d.length === 0) continue;
    // capture the first occurence of a b32 delimiter "-"
    if (isStampQuery(d)) {
      s = d;
      break;
    }
  }
  // overwrite if there exists a b64 flag in path
  for (const p of paths) {
    if (p.length === 0) continue;
    // skip to next if path has `/dns-query` or `/gateway` or '/l:'
    if (isStampQuery(p)) {
      s = p;
      break;
    }
  }

  // get blockstamp with access-key from paths[1|2] or from hostname[0|1]
  try {
    // FIXME: the array returned here may not always be of length 4
    return splitBlockstamp(s);
  } catch (e) {
    log.d("Rdns:blockstampFromUrl", e);
  }

  return emptystamp;
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

function splitBlockstamp(s) {
  // delim, version, blockstamp, accesskey

  if (util.emptyString(s)) return emptystamp;
  if (!isStampQuery(s)) return emptystamp;

  if (isB32Stamp(s)) {
    return [_b32delim, ...s.split(_b32delim)];
  } else {
    return [_b64delim, ...s.split(_b64delim)];
  }

  return out;
}

export function isB32Stamp(s) {
  const idx32 = s.indexOf(_b32delim);
  const idx64 = s.indexOf(_b64delim);
  if (idx32 === -1 && idx64 === -1) throw new Error("invalid stamp: " + s);
  else if (idx32 === -1) return false;
  else if (idx64 === -1) return true;
  else return idx32 < idx64;
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
  // "v:b64" or "v-b32" or "uriencoded(b64)", where v is uint version
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

// returns true if tstamp is of form yyyy/epochMs
function isValidFullTimestamp(tstamp) {
  if (typeof tstamp !== "string") return false;
  return tstamp.indexOf("/") === 4;
}

// from: github.com/celzero/downloads/blob/main/src/timestamp.js
export function bareTimestampFrom(tstamp) {
  // strip out "/" if tstamp is of form yyyy/epochMs
  if (isValidFullTimestamp(tstamp)) {
    tstamp = tstamp.split("/")[1];
  }
  const t = parseInt(tstamp);
  if (isNaN(t)) {
    log.w("Rdns bareTstamp: NaN", tstamp);
    return 0;
  }
  return t;
}

export function blocklists(strflag) {
  const { userBlocklistFlagUint, flagVersion } = unstamp(strflag);
  const blocklists = [];
  if (flagVersion === "1") {
    return trie.flagsToTags(userBlocklistFlagUint);
  } else {
    throw new Error("unknown blocklist version: " + flagVersion);
  }
  return blocklists;
}
