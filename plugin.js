/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

var userOperation = new (require("@serverless-dns/basic").UserOperation)()
var dnsBlock = new (require("@serverless-dns/dns-operation").DNSBlock)()
var dnsResolver = new (require("@serverless-dns/dns-operation").DNSResolver)()
var dnsCnameBlock = new (require("@serverless-dns/dns-operation").DNSCnameBlock)()
class RethinkPlugin {
    constructor(blocklistFilter, event) {
        this.parameter = new Map()
        this.registerParameter("blocklistFilter", blocklistFilter)
        this.registerParameter("event", event)
        this.plugin = new Array()
        this.registerPlugin("userOperation", userOperation, ["event", "blocklistFilter"], userOperationCallBack, false)
        this.registerPlugin("dnsBlock", dnsBlock, ["event", "blocklistFilter", "userBlocklistInfo"], dnsBlockCallBack, false)
        this.registerPlugin("dnsResolver", dnsResolver, ["event", "userBlocklistInfo"], dnsResolverCallBack, false)
        this.registerPlugin("dnsCnameBlock", dnsCnameBlock, ["event", "userBlocklistInfo", "blocklistFilter", "dnsResolverResponse"], dnsCnameBlockCallBack, false)
    }

    registerParameter(key, parameter) {
        this.parameter.set(key, parameter)
    }

    registerPlugin(pluginName, module, parameter, callBack, continueOnStopProcess) {
        this.plugin.push({ name: pluginName, module: module, param: parameter, callBack: callBack, continueOnStopProcess: continueOnStopProcess })
    }

    async executePlugin(currentRequest) {
        for (let singlePlugin of this.plugin) {
            if (currentRequest.stopProcessing && !singlePlugin.continueOnStopProcess) {
                continue
            }
            let response = await singlePlugin.module.RethinkModule(generateParam.call(this, singlePlugin.param))
            if (singlePlugin.callBack) {
                singlePlugin.callBack.call(this, response, currentRequest)
            }
        }
    }
}

function userOperationCallBack(response, currentRequest) {
    if (response.isException) {
        console.log("In userOperationCallBack Exception")
        console.log(JSON.stringify(response))
        loadException(response, currentRequest)
    }
    else if (!response.data.isValidFlag && !response.data.isEmptyFlag) {
        console.log("In userOperationCallBack data failure")
        console.log(JSON.stringify(response.data))
        currentRequest.stopProcessing = true
        currentRequest.customResponse({ errorFrom: "plugin.js userOperationCallBack", errorReason: "Invalid input user flag" })

    }
    else {
        console.log("In userOperationCallBack success")
        console.log(JSON.stringify(response.data))
        this.registerParameter("userBlocklistInfo", response.data)
    }
}

function dnsBlockCallBack(response, currentRequest) {
    if (response.isException) {
        console.log("In dnsBlockCallBack Exception")
        console.log(JSON.stringify(response))
        loadException(response, currentRequest)
    }
    else {
        console.log("In dnsBlockCallBack success")
        console.log(JSON.stringify(response.data))
        this.registerParameter("dnsBlockResponse", response.data)
        currentRequest.isDnsBlock = response.data.isBlocked
        currentRequest.isDomainInBlockListNotBlocked = response.data.isNotBlockedExistInBlocklist
        currentRequest.decodedDnsPacket = response.data.decodedDnsPacket
        currentRequest.blockedB64Flag = response.data.blockedB64Flag
        if (currentRequest.isDnsBlock) {
            currentRequest.stopProcessing = true
            currentRequest.dnsBlockResponse()
        }
        else {
            currentRequest.customResponse({ errorFrom: "No Error" })
        }
    }
}
function dnsResolverCallBack(response, currentRequest) {
    if (response.isException) {
        console.log("In dnsResolverCallBack Exception")
        console.log(JSON.stringify(response))
        loadException(response, currentRequest)
    }
    else {
        console.log("In dnsResolverCallBack success")
        console.log(JSON.stringify(response.data))
        this.registerParameter("dnsResolverResponse", response.data)
        currentRequest.httpResponse = response.data.dnsResponse
    }
}

function dnsCnameBlockCallBack(response, currentRequest) {
    if (response.isException) {
        console.log("In dnsCnameBlockCallBack Exception")
        console.log(JSON.stringify(response))
        loadException(response, currentRequest)
    }
    else {
        console.log("In dnsCnameBlockCallBack success")
        console.log(JSON.stringify(response.data))
        this.registerParameter("dnsCnameBlockResponse", response.data)
        currentRequest.isDnsBlock = response.data.isBlocked
        currentRequest.isDomainInBlockListNotBlocked = response.data.isNotBlockedExistInBlocklist
        currentRequest.decodedDnsPacket = response.data.decodedDnsPacket
        currentRequest.blockedB64Flag = response.data.blockedB64Flag
        if (currentRequest.isDnsBlock) {
            currentRequest.stopProcessing = true
            currentRequest.dnsBlockResponse()
        }
    }
}


function loadException(response, currentRequest) {
    currentRequest.stopProcessing = true
    currentRequest.isException = true
    currentRequest.exceptionStack = response.exceptionStack
    currentRequest.exceptionFrom = response.exceptionFrom
    currentRequest.dnsExceptionResponse()
}

function generateParam(list) {
    let param = {}
    for (let key of list) {
        if (this.parameter.has(key)) {
            param[key] = this.parameter.get(key)
        }
    }
    console.log(param)
    return param
}

module.exports.RethinkPlugin = RethinkPlugin