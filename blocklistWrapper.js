/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

var LocalCache = require('@serverless-dns/cache-wrapper').LocalCache
var radixTrieOperation = require("./radixTrie.js")
class BlocklistWrapper {
    constructor() {
        this.t
        this.ft
        this.bufferList
        this.blocklistBasicConfig
        this.blocklistFileTag
        this.isBlocklistLoaded = false
        this.isBlocklistUnderConstruction = false
        this.isBlocklistLoadException = false
        this.exceptionStack
        this.exceptionFrom = ""
        this.blocklistUrl = CF_BLOCKLIST_URL
        this.latestTimestamp = CF_LATEST_BLOCKLIST_TIMESTAMP
        this.domainNameCache = new LocalCache("Domain-Name-Cache", 5000, 500, 5)
        this.wildCardLists = new Set()
        this.wildCardUint
        setWildcardlist.call(this)
    }


    async initBlocklistConstruction() {
        try {
            await downloadBuildBlocklist.call(this)                    
        }
        catch (e) {
            this.isBlocklistLoadException = true
            this.exceptionStack = e.stack
            this.exceptionFrom = "UseTrie.js downloadBuildBlocklist " + this.exceptionFrom
        }
    }

    getDomainInfo(domainName, event) {
		let domainNameInfo = this.domainNameCache.Get(domainName)

		if (!domainNameInfo) {
			domainNameInfo = {}
			domainNameInfo.k = domainName
			domainNameInfo.data = {}
			domainNameInfo.data.searchResult = this.hadDomainName(domainName)
		}

		this.domainNameCache.Put(domainNameInfo, event)
		return domainNameInfo
	}

    hadDomainName(domainName) {
        let enc = new TextEncoder()
        return this.ft.lookup(enc.encode(domainName).reverse())
    }

    getTag(uintFlag) {
        return this.t.flagsToTag(uintFlag)
    }

    userB64FlagProcess(b64Flag) {
        return userFlagConvertB64ToUint(b64Flag)
    }

    flagIntersection(flag1, flag2) {
        try {
            let flag1Header = flag1[0]
            let flag2Header = flag2[0]
            let intersectHeader = flag1Header & flag2Header
            if (intersectHeader == 0) {
                //console.log("first return")
                return false
            }
            let flag1Length = flag1.length - 1
            let flag2Length = flag2.length - 1
            let intersectBody = new Array()
            let tmpInterectHeader = intersectHeader
            let maskHeaderForBodyEmpty = 1
            let tmpBodyIntersect
            for (; tmpInterectHeader != 0;) {
                if ((flag1Header & 1) == 1) {
                    if ((tmpInterectHeader & 1) == 1) {
                        tmpBodyIntersect = flag1[flag1Length] & flag2[flag2Length]
                        //console.log(flag1[flag1Length] + " :&: " + flag2[flag2Length] + " -- " + tmpBodyIntersect)
                        if (tmpBodyIntersect == 0) {
                            intersectHeader = intersectHeader ^ maskHeaderForBodyEmpty
                        }
                        else {
                            intersectBody.push(tmpBodyIntersect)
                        }

                    }
                    flag1Length = flag1Length - 1
                }
                if ((flag2Header & 1) == 1) {
                    flag2Length = flag2Length - 1
                }
                flag1Header = flag1Header >>> 1
                tmpInterectHeader = tmpInterectHeader >>> 1
                flag2Header = flag2Header >>> 1
                maskHeaderForBodyEmpty = maskHeaderForBodyEmpty * 2
            }
            //console.log(intersectBody)
            if (intersectHeader == 0) {
                //console.log("Second Return")
                return false
            }
            let intersectFlag = new Uint16Array(intersectBody.length + 1)
            let count = 0
            intersectFlag[count++] = intersectHeader
            let bodyData
            while ((bodyData = intersectBody.pop()) != undefined) {
                intersectFlag[count++] = bodyData
            }
            return intersectFlag
        }
        catch (e) {
            throw e
        }
    }

    customTagToFlag(tagList) {
        return radixTrieOperation.customTagToFlag(tagList, this.blocklistFileTag)
    }

    getB64FlagFromTag(tagList, flagVersion) {
        try {
            if (flagVersion == "0") {
                return encodeURIComponent(Buffer.from(radixTrieOperation.customTagToFlag(tagList, this.blocklistFileTag)).toString('base64'))
            }
            else if (flagVersion == "1") {
                return "1:" + encodeURI(btoa(encodeToBinary(radixTrieOperation.customTagToFlag(tagList, this.blocklistFileTag))).replace(/\//g, '_').replace(/\+/g, '-'))
            }
        }
        catch (e) {
            throw e
        }

    }

    getB64FlagFromUint16(arr, flagVersion) {
        try {
            if (flagVersion == "0") {
                return encodeURIComponent(Buffer.from(arr).toString('base64'))
            }
            else if (flagVersion == "1") {
                return "1:" + encodeURI(btoa(encodeUint16arrToBinary(arr)).replace(/\//g, '_').replace(/\+/g, '-'))
            }
        }
        catch (e) {
            throw e
        }
    }

}

async function downloadBuildBlocklist() {
    try {
        this.isBlocklistUnderConstruction = true
        var decoder = new TextDecoder()

        let buf0 = fileFetch.call(this, this.blocklistUrl + this.latestTimestamp + "/basicconfig.json")
        let buf1 = fileFetch.call(this, this.blocklistUrl + this.latestTimestamp + "/filetag.json")
        let buf2 = fileFetch.call(this, this.blocklistUrl + this.latestTimestamp + "/td.txt")
        let buf3 = fileFetch.call(this, this.blocklistUrl + this.latestTimestamp + "/rd.txt")

        this.bufferList = await Promise.all([buf0, buf1, buf2, buf3]);

        this.blocklistBasicConfig = JSON.parse(decoder.decode(this.bufferList[0]))
        this.blocklistFileTag = JSON.parse(decoder.decode(this.bufferList[1]))
        let resp = await radixTrieOperation.createBlocklistFilter(this.bufferList[2], this.bufferList[3], this.blocklistFileTag, this.blocklistBasicConfig)
        this.t = resp.t
        this.ft = resp.ft
        let str = radixTrieOperation.customTagToFlag(this.wildCardLists, this.blocklistFileTag)
        this.wildCardUint = new Uint16Array(str.length);
        for (let i = 0; i < this.wildCardUint.length; i++) {
            this.wildCardUint[i] = str.charCodeAt(i);
        }

        this.isBlocklistUnderConstruction = false
        this.isBlocklistLoaded = true
    }
    catch (e) {
        this.isException = true
        this.exceptionStack = e.stack
        this.exceptionFrom = "UseTrie.js downloadBuildBlocklist " + this.exceptionFrom
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

function userFlagConvertB64ToUint(b64Flag) {
    try {
        let response = {}
        response.isValidFlag = true
        response.userBlocklistFlagUint = ""
        response.flagVersion = "0"
        //added to check if UserFlag is empty for changing dns request flow
        response.isEmptyFlag = false
        b64Flag = b64Flag.trim()

        if (b64Flag == "") {
            response.isValidFlag = false
            response.isEmptyFlag = true
            return response
        }
        let splitFlag = b64Flag.split(':')
        if (splitFlag.length == 0) {
            response.isValidFlag = false
            response.isEmptyFlag = true
            return response
        }
        else if (splitFlag.length == 1) {
            response.userBlocklistFlagUint = Base64ToUint(splitFlag[0]) || ""
            response.flagVersion = "0"
        }
        else {
            response.userBlocklistFlagUint = Base64ToUint_v1(splitFlag[1]) || ""
            response.flagVersion = splitFlag[0] || "0"
        }
        return response
    }
    catch (e) {
        throw e
    }
}

function Base64ToUint(b64Flag) {
    let buff = Buffer.from(decodeURIComponent(b64Flag), 'base64');
    str = buff.toString('utf-8')
    //singlerequest.flow.push(str)
    var uint = []
    for (var i = 0; i < str.length; i++) {
        uint[i] = str.charCodeAt(i) //DEC16(str[i])
    }
    return uint
}

function Base64ToUint_v1(b64Flag) {
    let str = decodeURI(b64Flag)
    str = decodeFromBinary(atob(str.replace(/_/g, '/').replace(/-/g, '+')))
    //singlerequest.flow.push(str)
    var uint = []
    for (var i = 0; i < str.length; i++) {
        uint[i] = str.charCodeAt(i) //DEC16(str[i])
    }
    return uint
}

function decodeFromBinary(b) {
    const bytes = new Uint8Array(b.length);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = b.charCodeAt(i);
    }
    return String.fromCharCode(...new Uint16Array(bytes.buffer));
}

async function fileFetch(url) {
    const res = await fetch(url, { cf: { cacheTtl: 604800 } });
    const b = await res.arrayBuffer();
    return b;
}

function setWildcardlist() {
    this.wildCardLists.add("KBI") // safe-search-not-supported
    this.wildCardLists.add("YWG") // nextdns dht-bootstrap-nodes
    this.wildCardLists.add("SMQ") // nextdns file-hosting
    this.wildCardLists.add("AQX") // nextdns proxies
    this.wildCardLists.add("BTG") // nextdns streaming audio
    this.wildCardLists.add("GUN") // nextdns streaming video
    this.wildCardLists.add("KSH") // nextdns torrent clients
    this.wildCardLists.add("WAS") // nextdns torrent trackers
    this.wildCardLists.add("AZY") // nextdns torrent websites
    this.wildCardLists.add("GWB") // nextdns usenet
    this.wildCardLists.add("YMG") // nextdns warez
    this.wildCardLists.add("CZM") // tiuxo porn
    this.wildCardLists.add("ZVO") // oblat social-networks
    this.wildCardLists.add("YOM") // 9gag srv
    this.wildCardLists.add("THR") // amazon srv
    this.wildCardLists.add("RPW") // blizzard srv
    this.wildCardLists.add("AMG") // dailymotion srv
    this.wildCardLists.add("WTJ") // discord srv
    this.wildCardLists.add("ZXU") // disney+ srv
    this.wildCardLists.add("FJG") // ebay srv
    this.wildCardLists.add("NYS") // facebook srv
    this.wildCardLists.add("OKG") // fortnite srv
    this.wildCardLists.add("KNP") // hulu srv
    this.wildCardLists.add("FLI") // imgur srv
    this.wildCardLists.add("RYX") // instagram srv
    this.wildCardLists.add("CIH") // leagueoflegends srv
    this.wildCardLists.add("PTE") // messenger srv
    this.wildCardLists.add("KEA") // minecraft srv
    this.wildCardLists.add("CMR") // netflix srv
    this.wildCardLists.add("DDO") // pinterest srv
    this.wildCardLists.add("VLM") // reddit srv
    this.wildCardLists.add("JEH") // roblox srv
    this.wildCardLists.add("XLX") // skype srv
    this.wildCardLists.add("OQW") // snapchat srv
    this.wildCardLists.add("FXC") // spotify srv
    this.wildCardLists.add("HZJ") // steam srv
    this.wildCardLists.add("SWK") // telegram srv
    this.wildCardLists.add("VAM") // tiktok srv
    this.wildCardLists.add("AOS") // tinder srv
    this.wildCardLists.add("FAL") // tumblr srv
    this.wildCardLists.add("CZK") // twitch srv
    this.wildCardLists.add("FZB") // twitter srv
    this.wildCardLists.add("PYW") // vimeo srv
    this.wildCardLists.add("JXA") // vk srv
    this.wildCardLists.add("KOR") // whatsapp srv
    this.wildCardLists.add("DEP") // youtube srv
    this.wildCardLists.add("RFX") // zoom srv
    this.wildCardLists.add("RAF") // parked-domains
    this.wildCardLists.add("RKG") // infosec.cert-pa.it
    this.wildCardLists.add("GLV") // covid malware sophos labs
    this.wildCardLists.add("FHW") // alexa native
    this.wildCardLists.add("AGZ") // apple native
    this.wildCardLists.add("IVN") // huawei native
    this.wildCardLists.add("FIB") // roku native
    this.wildCardLists.add("FGF") // samsung native
    this.wildCardLists.add("FLL") // sonos native
    this.wildCardLists.add("IVO") // windows native
    this.wildCardLists.add("ALQ") // xiaomi native
}

module.exports.BlocklistWrapper = BlocklistWrapper;