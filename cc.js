/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

class CommandControl{
    constructor(){

    }


    async RethinkModule(commonContext, thisRequest, event) {
		if (event.request.method === "GET") {
            this.CommandOperation(event.request.url, thisRequest, commonContext)
        }
    }
    

    CommandOperation(url, thisRequest, commonContext) {
		try {
			thisRequest.StopProcessing = true
			let QueryString = (new URL(url)).searchParams
			let command = QueryString.get("command") || ""
			let returndata = {}
			if (command == "listtob64") {
				returndata = listToB64.call(this, QueryString, commonContext)
			}
			else if (command == "b64tolist") {
				returndata = b64ToList.call(this, QueryString, commonContext)
			}
			else if (command == "domainnametolist") {
				returndata = domainNameToList.call(this, QueryString, commonContext)
			}
			else if(command == "showlog"){
				returndata = showLog.call(this,commonContext)
			}
			thisRequest.httpResponse = new Response(JSON.stringify(returndata))
			thisRequest.httpResponse.headers.set('Content-Type', 'application/json')
			thisRequest.httpResponse.headers.set('Access-Control-Allow-Origin', '*')
			thisRequest.httpResponse.headers.set('Access-Control-Allow-Headers', '*')
		}
		catch (e) {
			thisRequest.httpResponse = new Response(JSON.stringify(e.stack))
			thisRequest.httpResponse.headers.set('Content-Type', 'application/json')
			thisRequest.httpResponse.headers.set('Access-Control-Allow-Origin', '*')
			thisRequest.httpResponse.headers.set('Access-Control-Allow-Headers', '*')
		}
	}
}

function showLog(commonContext){
	return commonContext.RequestLogs
}
function domainNameToList(QueryString,commonContext) {
	let DomainName = QueryString.get("domainname") || ""
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
	return returndata
}
function listToB64(QueryString, commonContext) {
	let list = QueryString.get("list") || []
	let flagVersion = parseInt(QueryString.get("flagversion")) || 0
	let returndata = {}
	returndata.command = "List To B64String"
	returndata.inputList = list
	returndata.flagVersion = flagVersion
	returndata.b64String = commonContext.BlockListFilter.Blocklist.getB64Flag(list.split(","), commonContext.BlockListFilter.blocklistFileTag, flagVersion)
	return returndata
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
	return returndata
}

module.exports.CommandControl = CommandControl
