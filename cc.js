/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

class CommandControl {
	constructor() {

	}


	async RethinkModule(commonContext, thisRequest, event) {
		if (event.request.method === "GET") {
			this.CommandOperation(event.request.url, thisRequest, commonContext)
		}
	}


	CommandOperation(url, thisRequest, commonContext) {
		try {
			thisRequest.StopProcessing = true
			let reqUrl = new URL(url)
			let QueryString = reqUrl.searchParams
			let pathSplit = reqUrl.pathname.split("/")
			let command = pathSplit[1]
			if (command == "listtob64") {
				thisRequest.httpResponse = listToB64.call(this, QueryString, commonContext)
			}
			else if (command == "b64tolist") {
				thisRequest.httpResponse = b64ToList.call(this, QueryString, commonContext)
			}
			else if (command == "dntolist") {
				thisRequest.httpResponse = domainNameToList.call(this, QueryString, commonContext)
			}
			else if (command == "showlog") {
				thisRequest.httpResponse = showLog.call(this, commonContext)
			}
			else if (command == "config" || command == "configure") {
				let B64UserFlag = ""
				if (pathSplit.length >= 3) {
					B64UserFlag = pathSplit[2]
				}
				thisRequest.httpResponse = configRedirect.call(this, B64UserFlag, reqUrl.origin, commonContext)
			}
			else {
				thisRequest.httpResponse = new Response(JSON.stringify("bad request"))
				thisRequest.httpResponse.headers.set('Content-Type', 'application/json')
				thisRequest.httpResponse.headers.set('Access-Control-Allow-Origin', '*')
				thisRequest.httpResponse.headers.set('Access-Control-Allow-Headers', '*')
			}
		}
		catch (e) {
			thisRequest.httpResponse = new Response(JSON.stringify(e.stack))
			thisRequest.httpResponse.headers.set('Content-Type', 'application/json')
			thisRequest.httpResponse.headers.set('Access-Control-Allow-Origin', '*')
			thisRequest.httpResponse.headers.set('Access-Control-Allow-Headers', '*')
		}
	}
}

function configRedirect(B64UserFlag, RequestUrlOrigin, commonContext) {
	let base = "https://rethinkdns.com/configure"
	let query = "?v=ext&u=" + RequestUrlOrigin + "&tstamp=" + commonContext.GlobalContext.CFmember.latestBlocklistTimestamp + "#" + B64UserFlag
	return Response.redirect(base + query, 302)

}
function showLog(commonContext) {
	let response = new Response(JSON.stringify(commonContext.RequestLogs))
	response.headers.set('Content-Type', 'application/json')
	response.headers.set('Access-Control-Allow-Origin', '*')
	response.headers.set('Access-Control-Allow-Headers', '*')
	return response
}
function domainNameToList(QueryString, commonContext) {
	let DomainName = QueryString.get("dn") || ""
	let returndata = {}
	returndata.domainName = DomainName
	returndata.list = {}
	var searchResult = commonContext.BlockListFilter.Blocklist.hadDomainName(DomainName)
	if (searchResult) {
		let list
		let listDetail = {}
		for (let entry of searchResult) {
			list = commonContext.BlockListFilter.Blocklist.getTag(entry[1])
			listDetail = {}
			for (let listValue of list) {
				listDetail[listValue] = commonContext.BlockListFilter.blocklistFileTag[listValue]
			}
			returndata.list[entry[0]] = listDetail
		}
	}
	else {
		returndata.list = false
	}

	let response = new Response(JSON.stringify(returndata))
	response.headers.set('Content-Type', 'application/json')
	response.headers.set('Access-Control-Allow-Origin', '*')
	response.headers.set('Access-Control-Allow-Headers', '*')
	return response
}
function listToB64(QueryString, commonContext) {
	let list = QueryString.get("list") || []
	let flagVersion = parseInt(QueryString.get("flagversion")) || 0
	let returndata = {}
	returndata.command = "List To B64String"
	returndata.inputList = list
	returndata.flagVersion = flagVersion
	returndata.b64String = commonContext.BlockListFilter.Blocklist.getB64Flag(list.split(","), commonContext.BlockListFilter.blocklistFileTag, flagVersion)
	let response = new Response(JSON.stringify(returndata))
	response.headers.set('Content-Type', 'application/json')
	response.headers.set('Access-Control-Allow-Origin', '*')
	response.headers.set('Access-Control-Allow-Headers', '*')
	return response
}

function b64ToList(QueryString, commonContext) {
	let b64 = QueryString.get("b64") || ""
	let returndata = {}
	returndata.command = "Base64 To List"
	returndata.inputB64 = b64
	let response = commonContext.BlockListFilter.Blocklist.userB64FlagProcess(b64)
	if (response.isValidFlag) {
		returndata.list = commonContext.BlockListFilter.Blocklist.getTag(response.userBlocklistFlagUint)
		returndata.listDetail = {}
		for (let listValue of returndata.list) {
			returndata.listDetail[listValue] = commonContext.BlockListFilter.blocklistFileTag[listValue]
		}
	}
	else {
		returndata.list = "Invalid B64 String"
	}
	response = new Response(JSON.stringify(returndata))
	response.headers.set('Content-Type', 'application/json')
	response.headers.set('Access-Control-Allow-Origin', '*')
	response.headers.set('Access-Control-Allow-Headers', '*')
	return response
}

module.exports.CommandControl = CommandControl
