/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as util from "../helpers/util.js";

export function isBlocklistFiter(blf) {
  return (blf && blf.t && blf.ft)
}

export function doBlock(blf, userBlInfo, key, cf) {
  let blInfo = getDomainInfo(blf, cf, key);
  console.debug("blocklist filter result : ",JSON.stringify(blInfo))
  if (!blInfo) return false;
  let response = checkDomainBlocking(
    userBlInfo.userBlocklistFlagUint,
    userBlInfo.flagVersion,
    blInfo,
    key,
  );
  if (response && response.isBlocked) return response;

  if(!userBlInfo.userServiceListUint) return response;

  return checkWildcardBlocking(
    userBlInfo.userServiceListUint,
    userBlInfo.flagVersion,
    blInfo,
    key,
  );
}

function getDomainInfo(blf, cf, key) {
  if (isBlocklistFiter(blf)) {
    return blf.getDomainInfo(key).searchResult;
  }
  if (!cf && !cf.hasOwnProperty(key)) return false;
  return util.mapOf(cf[key]);
}

function checkDomainBlocking(ufUint, flagVersion, blocklistMap, dn) {
  try {
    let dnUint = blocklistMap.get(dn);
    if (!dnUint) return false;
    return checkFlagIntersection(ufUint, dnUint, flagVersion, blocklistMap, dn);
  } catch (e) {
    throw e;
  }
}

function checkWildcardBlocking(wcUint, flagVersion, blocklistMap, dn) {
  let dnSplit = dn.split(".");
  let dnJoin = "";
  let response = {};
  let dnUint;
  while (dnSplit.shift() != undefined) {
    dnJoin = dnSplit.join(".");
    dnUint = blocklistMap.get(dn);
    if (!dnUint) return false;
    response = checkFlagIntersection(
      wcUint,
      dnUint,
      flagVersion,
      blocklistMap,
      dnJoin,
    );
    if (response && response.isBlocked) {
      return response;
    }
  }
  return false;
}

function checkFlagIntersection(uint1, uint2, flagVersion, blocklistMap, key) {
  try {
    let response = {};
    response.isBlocked = false;
    response.blockedB64Flag = "";
    response.blockedTag = [];
    let dnUint = blocklistMap.get(key);
    let blockedUint = flagIntersection(uint1, uint2);
    if (blockedUint) {
      response.isBlocked = true;
      response.blockedB64Flag = getB64Flag(
        blockedUint,
        flagVersion,
      );
    } else {
      blockedUint = new Uint16Array(dnUint);
      response.blockedB64Flag = getB64Flag(
        blockedUint,
        flagVersion,
      );
    }
    return response;    
    //response.blockedTag = blocklistFilter.getTag(blockedUint);
  } catch (e) {
    throw e;
  }
}

export function flagIntersection(flag1, flag2) {  
  try {
    if (util.emptyString(flag1) || util.emptyString(flag2)) return false;
    let flag1Header = flag1[0];
    let flag2Header = flag2[0];
    let intersectHeader = flag1Header & flag2Header;
    if (intersectHeader == 0) {
      //console.log("first return")
      return false;
    }
    let flag1Length = flag1.length - 1;
    let flag2Length = flag2.length - 1;
    const intersectBody = [];
    let tmpInterectHeader = intersectHeader;
    let maskHeaderForBodyEmpty = 1;
    let tmpBodyIntersect;
    for (; tmpInterectHeader != 0;) {
      if ((flag1Header & 1) == 1) {
        if ((tmpInterectHeader & 1) == 1) {
          tmpBodyIntersect = flag1[flag1Length] & flag2[flag2Length];
          //console.log(flag1[flag1Length] + " :&: " + flag2[flag2Length] + " -- " + tmpBodyIntersect)
          if (tmpBodyIntersect == 0) {
            intersectHeader = intersectHeader ^ maskHeaderForBodyEmpty;
          } else {
            intersectBody.push(tmpBodyIntersect);
          }
        }
        flag1Length = flag1Length - 1;
      }
      if ((flag2Header & 1) == 1) {
        flag2Length = flag2Length - 1;
      }
      flag1Header = flag1Header >>> 1;
      tmpInterectHeader = tmpInterectHeader >>> 1;
      flag2Header = flag2Header >>> 1;
      maskHeaderForBodyEmpty = maskHeaderForBodyEmpty * 2;
    }
    //console.log(intersectBody)
    if (intersectHeader == 0) {
      //console.log("Second Return")
      return false;
    }
    const intersectFlag = new Uint16Array(intersectBody.length + 1);
    let count = 0;
    intersectFlag[count++] = intersectHeader;
    let bodyData;
    while ((bodyData = intersectBody.pop()) != undefined) {
      intersectFlag[count++] = bodyData;
    }
    return intersectFlag;
  } catch (e) {
    throw e;
  }
}

function getB64Flag(uint16Arr, flagVersion) {
  try {
    if (flagVersion == "0") {
      return encodeURIComponent(Buffer.from(uint16Arr).toString("base64"));
    } else if (flagVersion == "1") {
      return "1:" +
        encodeURI(
          btoa(encodeUint16arrToBinary(uint16Arr)).replace(/\//g, "_").replace(
            /\+/g,
            "-",
          ),
        );
    }
  } catch (e) {
    throw e;
  }
}

function encodeUint16arrToBinary(uint16Arr) {
  return String.fromCharCode(...new Uint8Array(uint16Arr.buffer));
}
