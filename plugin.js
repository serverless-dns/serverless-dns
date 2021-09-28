/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
var commandControl = new (require("@serverless-dns/command-control").CommandControl)()
var userOperation = new (require("@serverless-dns/basic").UserOperation)()
var dnsBlock = new (require("@serverless-dns/dns-operation").DNSBlock)()
var dnsResolver = new (require("@serverless-dns/dns-operation").DNSResolver)()
var dnsCnameBlock = new (require("@serverless-dns/dns-operation").DNSCnameBlock)()
class RethinkPlugin {
    constructor(blocklistFilter, event) {
        this.parameter = new Map()
        this.registerParameter("blocklistFilter", blocklistFilter)
        this.registerParameter("request", event.request)
        this.registerParameter("event", event)
        this.plugin = new Array()
        this.registerPlugin("commandControl", commandControl, ["request", "blocklistFilter"], commandControlCallBack, false)
        this.registerPlugin("userOperation", userOperation, ["event", "blocklistFilter"], userOperationCallBack, false)
        this.registerPlugin("dnsBlock", dnsBlock, ["requestBodyBuffer", "event", "blocklistFilter", "userBlocklistInfo"], dnsBlockCallBack, false)
        this.registerPlugin("dnsResolver", dnsResolver, ["requestBodyBuffer", "request", "dnsResolverUrl"], dnsResolverCallBack, false)
        this.registerPlugin("dnsCnameBlock", dnsCnameBlock, ["event", "userBlocklistInfo", "blocklistFilter", "responseBodyBuffer"], dnsCnameBlockCallBack, false)
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
                await singlePlugin.callBack.call(this, response, currentRequest)
            }
        }
    }
}


async function commandControlCallBack(response, currentRequest) {
    if (response.data.stopProcessing) {
        //console.log("In userOperationCallBack")
        //console.log(JSON.stringify(response.data))
        currentRequest.httpResponse = response.data.httpResponse
        currentRequest.stopProcessing = true
    }
    else {
        let request = this.parameter.get("request")
        let bodyBuffer
        if (request.method.toUpperCase() === "GET") {
            let QueryString = (new URL(request.url)).searchParams
            bodyBuffer = base64ToArrayBuffer(decodeURI(QueryString.get("dns")))
        }
        else {
            bodyBuffer = await request.arrayBuffer()
        }
        this.registerParameter("requestBodyBuffer", bodyBuffer)
    }
}

function userOperationCallBack(response, currentRequest) {
    if (response.isException) {
        //console.log("In userOperationCallBack Exception")
        //console.log(JSON.stringify(response))
        loadException(response, currentRequest)
    }
    else if (!response.data.isValidFlag && !response.data.isEmptyFlag) {
        //console.log("In userOperationCallBack data failure")
        //console.log(JSON.stringify(response.data))
        currentRequest.stopProcessing = true
        currentRequest.customResponse({ errorFrom: "plugin.js userOperationCallBack", errorReason: "Invalid input user flag" })

    }
    else {
        //console.log("In userOperationCallBack success")
        //console.log(JSON.stringify(response.data))
        this.registerParameter("userBlocklistInfo", response.data)
        this.registerParameter("dnsResolverUrl", response.data.dnsResolverUrl)
    }
}

function dnsBlockCallBack(response, currentRequest) {
    if (response.isException) {
        //console.log("In dnsBlockCallBack Exception")
        //console.log(JSON.stringify(response))
        loadException(response, currentRequest)
    }
    else {
        //console.log("In dnsBlockCallBack success")
        //console.log(JSON.stringify(response.data))
        this.registerParameter("dnsBlockResponse", response.data)
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
function dnsResolverCallBack(response, currentRequest) {
    if (response.isException) {
        //console.log("In dnsResolverCallBack Exception")
        //console.log(JSON.stringify(response))
        loadException(response, currentRequest)
    }
    else {
        //console.log("In dnsResolverCallBack success")
        //console.log(JSON.stringify(response.data))
        this.registerParameter("responseBodyBuffer", response.data.responseBodyBuffer)
        //currentRequest.httpResponse = response.data.dnsResponse
    }
}

function dnsCnameBlockCallBack(response, currentRequest) {
    if (response.isException) {
        //console.log("In dnsCnameBlockCallBack Exception")
        //console.log(JSON.stringify(response))
        loadException(response, currentRequest)
    }
    else {
        //console.log("In dnsCnameBlockCallBack success")
        //console.log(JSON.stringify(response.data))
        this.registerParameter("dnsCnameBlockResponse", response.data)
        currentRequest.isDnsBlock = response.data.isBlocked
        currentRequest.isDomainInBlockListNotBlocked = response.data.isNotBlockedExistInBlocklist
        currentRequest.decodedDnsPacket = response.data.decodedDnsPacket
        currentRequest.blockedB64Flag = response.data.blockedB64Flag
        if (currentRequest.isDnsBlock) {
            currentRequest.stopProcessing = true
            currentRequest.dnsBlockResponse()
        }
        else{
            currentRequest.dnsResponse(this.parameter.get("responseBodyBuffer"))
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
    //console.log(param)
    return param
}

function base64ToArrayBuffer(base64) {
    var binary_string = atob(base64);
    var len = binary_string.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}
module.exports.RethinkPlugin = RethinkPlugin