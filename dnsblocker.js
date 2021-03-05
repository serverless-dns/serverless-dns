/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

var CreateError = require('@serverless-dns/error')
var DnsParser = require('@serverless-dns/dns-parser')


class DNSResolver {
	constructor(){

	}

	async RethinkModule(commonContext, thisRequest, event) {
		if(thisRequest.IsDnsBlock == false){
			await this.ResolveDns(thisRequest)
		}		
	}

	async ResolveDns(thisRequest) {
		try {
			let res = await forwardDnsMessage(thisRequest.httpRequest)

			thisRequest.httpResponse = new Response(res.body, res)
			thisRequest.httpResponse.headers.set('Content-Type', 'application/dns-message')
			thisRequest.httpResponse.headers.set('Access-Control-Allow-Origin', '*')
			thisRequest.httpResponse.headers.set('Access-Control-Allow-Headers', '*')
			thisRequest.httpResponse.headers.append('Vary', 'Origin')
			thisRequest.httpResponse.headers.set('server', 'bravedns')
			thisRequest.httpResponse.headers.delete('expect-ct')
			thisRequest.httpResponse.headers.delete('cf-ray')
		}
		catch (e) {
			thisRequest.StopProcessing = true
			thisRequest.IsException = true
			thisRequest.exception = e
			thisRequest.exceptionFrom = "dnsblocker.js DnsWork ResolveDns"
		}
	}
}

class DNSCnameBlock{
	constructor(){

	}

	async RethinkModule(commonContext, thisRequest, event) {
		if(thisRequest.IsDnsBlock == false){
			await this.CheckResponseCnameDnsBlock(thisRequest, commonContext, event)
		}		
	}

	async CheckResponseCnameDnsBlock(thisRequest, commonContext, event) {
		try {
			let tmpReq = await thisRequest.httpResponse.clone();
			try {
				thisRequest.DecodedDnsPacket = await dnsPacketDecode(await tmpReq.arrayBuffer())
			}
			catch (e) {
				thisRequest.StopProcessing = true
				thisRequest.IsException = true
				thisRequest.IsDnsParseException = true
				thisRequest.exception = e
				thisRequest.exceptionFrom = "dnsblocker.js DnsWork CheckResponseCnameDnsBlock"
				return
			}
			if(checkCnameDnsBlock.call(this, thisRequest, commonContext, event) == true){
				thisRequest.DnsBlockResponse()
			}
		}
		catch (e) {
			thisRequest.StopProcessing = true
			thisRequest.IsException = true
			thisRequest.exception = e
			thisRequest.exceptionFrom = "dnsblocker.js DnsWork CheckResponseCnameDnsBlock"
		}
	}
}
class DNSBlock{
	constructor(){

	}

	async RethinkModule(commonContext, thisRequest, event) {
		await this.CheckDnsBlock(thisRequest, commonContext)
	}

	async CheckDnsBlock(thisRequest, commonContext) {
		try {
			if(checkDnsRequestBlock.call(this, thisRequest, commonContext) == true){
				thisRequest.DnsBlockResponse()
			}
		}
		catch (e) {
			thisRequest.StopProcessing = true
			thisRequest.IsException = true
			thisRequest.exception = e
			thisRequest.exceptionFrom = "dnsblocker.js DnsWork CheckDnsBlock"
		}

	}
}
class DNSWork {
	constructor() {

	}
	
	async Decode(arrayBuffer) {
		try {
			return dnsPacketDecode(arrayBuffer)
		}
		catch (e) {
			CreateError.CreateError("dnsblocker.js DnsWork Decode", e)
		}
	}
	Encode(DecodedDnsPacket) {
		try {
			return DnsParser.encode(DecodedDnsPacket);
		}
		catch (e) {
			CreateError.CreateError("dnsblocker.js DnsWork Encode", e)
		}
	}
}


function dnsPacketDecode(arrayBuffer){
	return DnsParser.decode(DnsParser.getBuff().from(new Uint8Array(arrayBuffer)))
}

async function forwardDnsMessage(request) {
	let u = new URL(request.url)
	u.hostname = "cloudflare-dns.com"
	u.pathname = "dns-query"

	request = new Request(u.href, request)
	request.headers.set('accept', 'application/dns-message')
	request.headers.set('content-type', 'application/dns-message')
	request.headers.set('Origin', u.origin)


	return await fetch(request)
}

function checkCnameDnsBlock(thisRequest, commonContext, event) {
	if (thisRequest.UserConfig.data.isValidFlag) {
		if (thisRequest.DecodedDnsPacket.answers.length > 0 && thisRequest.DecodedDnsPacket.answers[0].type === "CNAME") {
			let Cname = thisRequest.DecodedDnsPacket.answers[0].data.trim().toLowerCase()
			thisRequest.DomainNameInfo = thisRequest.GetDomainInfo(commonContext, Cname, event)
			if (thisRequest.DomainNameInfo.data.IsDomainNameInBlocklist) {
				if (checkDomainNameUserFlagIntersection(thisRequest, commonContext, Cname)) {
					thisRequest.IsCnameDnsBlock = true
					return true
				}

				if (thisRequest.UserConfig.data.IsServiceListEnabled) {
					if (checkBlockByServicelist(thisRequest, commonContext)) {
						thisRequest.IsCnameDnsBlock = true
						return true
					}
				}
			}


			Cname = thisRequest.DecodedDnsPacket.answers[thisRequest.DecodedDnsPacket.answers.length - 1].name.trim().toLowerCase()
			thisRequest.DomainNameInfo = thisRequest.GetDomainInfo(commonContext, Cname, event)
			if (thisRequest.DomainNameInfo.data.IsDomainNameInBlocklist) {
				if (checkDomainNameUserFlagIntersection(thisRequest, commonContext, Cname)) {
					thisRequest.IsCnameDnsBlock = true
					return true
				}

				if (thisRequest.UserConfig.data.IsServiceListEnabled) {
					if (checkBlockByServicelist(thisRequest, commonContext)) {
						thisRequest.IsCnameDnsBlock = true
						return true
					}
				}
			}

		}
	}
	return false
}

function checkDomainNameUserFlagIntersection(thisRequest, commonContext, DomainName) {
	try {
		if (thisRequest.DomainNameInfo.data.searchResult.has(DomainName)) {
			let domainNameBlocklistUintArr = thisRequest.DomainNameInfo.data.searchResult.get(DomainName)
			thisRequest.responseBlocklistUintarr = commonContext.BlockListFilter.Blocklist.flagIntersection(thisRequest.UserConfig.data.userBlocklistFlagUint, domainNameBlocklistUintArr)
			if (thisRequest.responseBlocklistUintarr != false) {
				thisRequest.responseBlocklistTag = commonContext.BlockListFilter.Blocklist.getTag(thisRequest.responseBlocklistUintarr)
				thisRequest.responseB64flag = commonContext.BlockListFilter.Blocklist.getB64Flag(thisRequest.responseBlocklistTag, commonContext.BlockListFilter.blocklistFileTag, thisRequest.UserConfig.data.flagVersion)
				return true
			}
		}
	}
	catch (e) {
		CreateError.CreateError("dnsblocker.js checkDomainNameUserFlagIntersection", e)
	}
	return false
}

function checkDomainNameWildCardUserFlagIntersection(thisRequest, commonContext, DomainName) {
	try {
		if (thisRequest.DomainNameInfo.data.searchResult.has(DomainName)) {
			let domainNameBlocklistUintArr = thisRequest.DomainNameInfo.data.searchResult.get(DomainName)
			let wildCardIntersectBlocklistUintarr = commonContext.BlockListFilter.Blocklist.flagIntersection(commonContext.GlobalContext.wildcardUint, domainNameBlocklistUintArr)
			if (wildCardIntersectBlocklistUintarr != false) {
				thisRequest.responseBlocklistUintarr = commonContext.BlockListFilter.Blocklist.flagIntersection(thisRequest.UserConfig.data.userBlocklistFlagUint, wildCardIntersectBlocklistUintarr)
				if (thisRequest.responseBlocklistUintarr != false) {
					thisRequest.responseBlocklistTag = commonContext.BlockListFilter.Blocklist.getTag(thisRequest.responseBlocklistUintarr)
					thisRequest.responseB64flag = commonContext.BlockListFilter.Blocklist.getB64Flag(thisRequest.responseBlocklistTag, commonContext.BlockListFilter.blocklistFileTag, thisRequest.UserConfig.data.flagVersion)
					return true
				}
			}
		}
	}
	catch (e) {
		CreateError.CreateError("dnsblocker.js checkDomainNameUserFlagIntersection", e)
	}
	return false
}

function checkDnsRequestBlock(thisRequest, commonContext) {
	try {
		if (thisRequest.UserConfig.data.isValidFlag && thisRequest.DomainNameInfo.data.IsDomainNameInBlocklist) {
			if ((thisRequest.UserConfig.data.userBlocklistFlagUint != "") && (thisRequest.DecodedDnsPacket.questions.length >= 1) && (thisRequest.DecodedDnsPacket.questions[0].type == "A" || thisRequest.DecodedDnsPacket.questions[0].type == "AAAA" || thisRequest.DecodedDnsPacket.questions[0].type == "CNAME")) {

				if (checkDomainNameUserFlagIntersection(thisRequest, commonContext, thisRequest.DomainName)) {
					thisRequest.IsDnsBlock = true
					return true
				}

				if (thisRequest.UserConfig.data.IsServiceListEnabled) {
					if (checkBlockByServicelist(thisRequest, commonContext)) {
						thisRequest.IsDnsBlock = true
						return true
					}
				}
			}
		}
		return false
	}
	catch (e) {
		CreateError.CreateError("dnsblocker.js checkDnsRequestBlock", e)
	}
}

function checkBlockByServicelist(thisRequest, commonContext) {
	try {
		let dnSplit = thisRequest.DomainNameInfo.k.split(".")
		let dnJoin = ""
		while (dnSplit.shift() != undefined) {
			dnJoin = dnSplit.join(".")
			if (checkDomainNameWildCardUserFlagIntersection(thisRequest, commonContext, dnJoin)) {
				return true
			}
		}
		return false
	}
	catch (e) {
		CreateError.CreateError("dnsblocker.js checkBlockByServicelist", e)
	}
}

module.exports.DnsWork = DNSWork
module.exports.DNSBlock = DNSBlock
module.exports.DNSCnameBlock = DNSCnameBlock
module.exports.DNSResolver = DNSResolver
