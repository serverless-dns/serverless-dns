/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { Buffer } from "buffer";
import { LocalCache } from "../cache-wrapper/cache-wrapper.js";
import { customTagToFlag as _customTagToFlag } from "./radixTrie.js";

import { base32, rbase32 } from "./b32.js";

export class BlocklistFilter {
  constructor() {
    this.t = null;
    this.ft = null;
    this.blocklistBasicConfig = null;
    this.blocklistFileTag = null;
    this.domainNameCache = null;
    //following wildCard array is hardcoded to avoid the usage of blocklistFileTag download from s3
    //the hard coded array contains the list of blocklist files mentioned at setWildcardlist()
    //TODO is future version wildcard list should be downloaded from KV or from env
    this.wildCardUint = new Uint16Array([
      64544,
      18431,
      8191,
      65535,
      64640,
      1,
      128,
      16320,
    ]);
    /*
    this.wildCardLists = new Set();
    setWildcardlist.call(this);
    const str = _customTagToFlag(
      this.wildCardLists,
      this.blocklistFileTag,
    );
    this.wildCardUint = new Uint16Array(str.length);
    for (let i = 0; i < this.wildCardUint.length; i++) {
      this.wildCardUint[i] = str.charCodeAt(i);
    }*/
  }

  loadFilter(t, ft, blocklistBasicConfig, blocklistFileTag) {
    this.t = t;
    this.ft = ft;
    this.blocklistBasicConfig = blocklistBasicConfig;
    this.blocklistFileTag = blocklistFileTag;
    this.domainNameCache = new LocalCache(
      "Domain-Name-Cache",
      5000,
    );
  }

  getDomainInfo(domainName) {
    domainName = domainName.trim().toLowerCase();
    let domainNameInfo = this.domainNameCache.Get(domainName);

    if (!domainNameInfo) {
      domainNameInfo = {};
      domainNameInfo.searchResult = this.hadDomainName(domainName);
      this.domainNameCache.Put(domainName, domainNameInfo);
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

  flagIntersection(flag1, flag2) {
    try {
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

  customTagToFlag(tagList) {
    return _customTagToFlag(tagList, this.blocklistFileTag);
  }

  getB64FlagFromTag(tagList, flagVersion) {
    try {
      if (flagVersion == "0") {
        return encodeURIComponent(
          Buffer.from(
            _customTagToFlag(tagList, this.blocklistFileTag),
          ).toString("base64"),
        );
      } else if (flagVersion == "1") {
        return "1:" +
          encodeURI(
            btoa(
              encodeToBinary(
                _customTagToFlag(
                  tagList,
                  this.blocklistFileTag,
                ),
              ),
            ).replace(/\//g, "_").replace(/\+/g, "-"),
          );
      }
    } catch (e) {
      throw e;
    }
  }

  getB64FlagFromUint16(arr, flagVersion) {
    try {
      if (flagVersion == "0") {
        return encodeURIComponent(Buffer.from(arr).toString("base64"));
      } else if (flagVersion == "1") {
        return "1:" +
          encodeURI(
            btoa(encodeUint16arrToBinary(arr)).replace(/\//g, "_").replace(
              /\+/g,
              "-",
            ),
          );
      }
    } catch (e) {
      throw e;
    }
  }
}

function encodeUint16arrToBinary(uint16Arr) {
  return String.fromCharCode(...new Uint8Array(uint16Arr.buffer));
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
    //added to check if UserFlag is empty for changing dns request flow
    flag = (flag) ? flag.trim() : "";

    if (flag.length <= 0) {
      return response;
    }

    const isFlagB32 = isB32(flag);
    // "v:b64" or "v+b32" or "uriencoded(b64)", where v is uint version
    let s = flag.split(isFlagB32 ? b32delim : b64delim);
    let convertor = (x) => ""; // empty convertor
    let f = ""; // stamp flag
    const v = version(s);

    if (v == "0") { // version 0
      convertor = Base64ToUint;
      f = s[0];
    } else if (v == "1") {
      convertor = (isFlagB32) ? Base32ToUint_v1 : Base64ToUint_v1;
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

function Base64ToUint_v1(b64Flag) {
  let str = decodeURI(b64Flag);
  str = decodeFromBinary(atob(str.replace(/_/g, "/").replace(/-/g, "+")));
  const uint = [];
  for (let i = 0; i < str.length; i++) {
    uint[i] = str.charCodeAt(i);
  }
  return uint;
}

function Base32ToUint_v1(flag) {
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

function setWildcardlist() {
  this.wildCardLists.add("KBI"); // safe-search-not-supported
  this.wildCardLists.add("YWG"); // nextdns dht-bootstrap-nodes
  this.wildCardLists.add("SMQ"); // nextdns file-hosting
  this.wildCardLists.add("AQX"); // nextdns proxies
  this.wildCardLists.add("BTG"); // nextdns streaming audio
  this.wildCardLists.add("GUN"); // nextdns streaming video
  this.wildCardLists.add("KSH"); // nextdns torrent clients
  this.wildCardLists.add("WAS"); // nextdns torrent trackers
  this.wildCardLists.add("AZY"); // nextdns torrent websites
  this.wildCardLists.add("GWB"); // nextdns usenet
  this.wildCardLists.add("YMG"); // nextdns warez
  this.wildCardLists.add("CZM"); // tiuxo porn
  this.wildCardLists.add("ZVO"); // oblat social-networks
  this.wildCardLists.add("YOM"); // 9gag srv
  this.wildCardLists.add("THR"); // amazon srv
  this.wildCardLists.add("RPW"); // blizzard srv
  this.wildCardLists.add("AMG"); // dailymotion srv
  this.wildCardLists.add("WTJ"); // discord srv
  this.wildCardLists.add("ZXU"); // disney+ srv
  this.wildCardLists.add("FJG"); // ebay srv
  this.wildCardLists.add("NYS"); // facebook srv
  this.wildCardLists.add("OKG"); // fortnite srv
  this.wildCardLists.add("KNP"); // hulu srv
  this.wildCardLists.add("FLI"); // imgur srv
  this.wildCardLists.add("RYX"); // instagram srv
  this.wildCardLists.add("CIH"); // leagueoflegends srv
  this.wildCardLists.add("PTE"); // messenger srv
  this.wildCardLists.add("KEA"); // minecraft srv
  this.wildCardLists.add("CMR"); // netflix srv
  this.wildCardLists.add("DDO"); // pinterest srv
  this.wildCardLists.add("VLM"); // reddit srv
  this.wildCardLists.add("JEH"); // roblox srv
  this.wildCardLists.add("XLX"); // skype srv
  this.wildCardLists.add("OQW"); // snapchat srv
  this.wildCardLists.add("FXC"); // spotify srv
  this.wildCardLists.add("HZJ"); // steam srv
  this.wildCardLists.add("SWK"); // telegram srv
  this.wildCardLists.add("VAM"); // tiktok srv
  this.wildCardLists.add("AOS"); // tinder srv
  this.wildCardLists.add("FAL"); // tumblr srv
  this.wildCardLists.add("CZK"); // twitch srv
  this.wildCardLists.add("FZB"); // twitter srv
  this.wildCardLists.add("PYW"); // vimeo srv
  this.wildCardLists.add("JXA"); // vk srv
  this.wildCardLists.add("KOR"); // whatsapp srv
  this.wildCardLists.add("DEP"); // youtube srv
  this.wildCardLists.add("RFX"); // zoom srv
  this.wildCardLists.add("RAF"); // parked-domains
  this.wildCardLists.add("RKG"); // infosec.cert-pa.it
  this.wildCardLists.add("GLV"); // covid malware sophos labs
  this.wildCardLists.add("FHW"); // alexa native
  this.wildCardLists.add("AGZ"); // apple native
  this.wildCardLists.add("IVN"); // huawei native
  this.wildCardLists.add("FIB"); // roku native
  this.wildCardLists.add("FGF"); // samsung native
  this.wildCardLists.add("FLL"); // sonos native
  this.wildCardLists.add("IVO"); // windows native
  this.wildCardLists.add("ALQ"); // xiaomi native
}
