/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as util from "../helpers/util.js";

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
  if (r && r.isBlocked) return r;

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

  if (cf && cf.hasOwnProperty(domain)) {
    return util.mapOf(cf[domain]);
  }

  if (blf && isBlocklistFilterSetup(blf)) {
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
      flag1Length = flag1Length - 1;
    }
    if ((flag2Header & 1) === 1) {
      flag2Length = flag2Length - 1;
    }

    // next header-bit, remove the LSB bit already processed
    flag1Header = flag1Header >>> 1;
    flag2Header = flag2Header >>> 1;
    tmpIntersectHeader = tmpIntersectHeader >>> 1;

    // tracks the header bit index to be reset in case bodies do not intersect
    maskHeaderForBodyEmpty = maskHeaderForBodyEmpty << 1;
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
    const flag = encodeURI(
      btoa(encodeUint16arrToBinary(uint16Arr))
        .replace(/\//g, "_")
        .replace(/\+/g, "-")
    );
    return flagVersion + ":" + flag;
  }
}

function encodeUint16arrToBinary(uint16Arr) {
  return String.fromCharCode(...new Uint8Array(uint16Arr.buffer));
}
