/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

var DNSParserWrap = require("./dnsParserWrap.js").DNSParserWrap

class DNSCnameBlock {
    constructor() {
        this.dnsParser = new DNSParserWrap()
    }
    /*
    param.userBlocklistInfo
    param.blocklistFilter
    param.event
    param.dnsResolverResponse
    */
    async RethinkModule(param) {
        let response = {}
        response.isException = false
        response.exceptionStack = ""
        response.exceptionFrom = ""
        response.data = {}
        response.data.isBlocked = false
        response.data.isNotBlockedExistInBlocklist = false
		response.data.domainNameInBlocklistUint
        response.data.domainNameUserBlocklistIntersection
		response.data.decodedDnsPacket
        try {
            let decodedDnsPacket = await loadDnsFromRequest(param.dnsResolverResponse.dnsResponse, this.dnsParser)
            if (param.userBlocklistInfo.isValidFlag) {
                let domainNameBlocklistInfo
                if (decodedDnsPacket.answers.length > 0 && decodedDnsPacket.answers[0].type == "CNAME") {
                    let cname = decodedDnsPacket.answers[0].data.trim().toLowerCase()
                    domainNameBlocklistInfo = param.blocklistFilter.getDomainInfo(cname, param.event)
                    if (domainNameBlocklistInfo.data.searchResult) {
                        response.data = checkDomainBlocking(param.userBlocklistInfo, domainNameBlocklistInfo, param.blocklistFilter, cname)
                    }

                    if (!response.data.isBlocked) {
                        cname = decodedDnsPacket.answers[decodedDnsPacket.answers.length - 1].name.trim().toLowerCase()
                        domainNameBlocklistInfo = param.blocklistFilter.getDomainInfo(cname, param.event)
                        if (domainNameBlocklistInfo.data.searchResult) {
                            response.data = checkDomainBlocking(param.userBlocklistInfo, domainNameBlocklistInfo, param.blocklistFilter, cname)
                        }
                    }
                }
            }
            response.data.decodedDnsPacket = decodedDnsPacket
        }
        catch (e) {
            response.isException = true
            response.exceptionStack = e.stack
            response.exceptionFrom = "DNSBlock RethinkModule"
            response.data = false
        }
        return response
    }
}


async function loadDnsFromRequest(request, dnsParser) {
    let dnsPacketBuffer
    try {
        let tmpReq = await request.clone();
        dnsPacketBuffer = await tmpReq.arrayBuffer()
        return await dnsParser.Decode(dnsPacketBuffer)
    }
    catch (e) {
        throw e
    }
}

function checkDomainBlocking(userBlocklistInfo, domainNameBlocklistInfo, blocklistFilter, domainName) {
    let response
    try {
        response = checkDomainNameUserFlagIntersection(userBlocklistInfo.userBlocklistFlagUint, userBlocklistInfo.flagVersion, domainNameBlocklistInfo, blocklistFilter, domainName)
        if (response.isBlocked) {
            return response
        }

        if (userBlocklistInfo.userServiceListUint) {
            let dnSplit = domainName.split(".")
            let dnJoin = ""
            let wildCardResponse  
            while (dnSplit.shift() != undefined) {
                dnJoin = dnSplit.join(".")
                wildCardResponse = checkDomainNameUserFlagIntersection(userBlocklistInfo.userServiceListUint, userBlocklistInfo.flagVersion, domainNameBlocklistInfo, blocklistFilter, dnJoin)
                if (wildCardResponse.isBlocked) {
                    return wildCardResponse
                }
            }
        }
    }
    catch (e) {
        throw e
    }

    return response
}

function checkDomainNameUserFlagIntersection(userBlocklistFlagUint, flagVersion, domainNameBlocklistInfo, blocklistFilter, domainName) {
    let response = {}
    try {
        response.isBlocked = false
        response.isNotBlockedExistInBlocklist = false
        response.blockedB64Flag = ""
        response.domainNameInBlocklistUint
        response.domainNameUserBlocklistIntersection
        if (domainNameBlocklistInfo.data.searchResult.has(domainName)) {
            response.domainNameInBlocklistUint = domainNameBlocklistInfo.data.searchResult.get(domainName)
            response.domainNameUserBlocklistIntersection = blocklistFilter.flagIntersection(userBlocklistFlagUint, response.domainNameInBlocklistUint)
            if (response.domainNameUserBlocklistIntersection) {
                response.isBlocked = true
                response.blockedB64Flag = blocklistFilter.getB64FlagFromUint16(response.domainNameUserBlocklistIntersection, flagVersion)
            }
            else {
                response.isNotBlockedExistInBlocklist = true
                let uint16ArrConversion = new Uint16Array(response.domainNameInBlocklistUint.length)
				let index = 0
				for(let singleBlock of response.domainNameInBlocklistUint){
					uint16ArrConversion[index] = singleBlock
					index++
				}
                response.blockedB64Flag = blocklistFilter.getB64FlagFromUint16(uint16ArrConversion, flagVersion)
            }
        }
    }
    catch (e) {
        throw e
    }
    return response
}
module.exports.DNSCnameBlock = DNSCnameBlock