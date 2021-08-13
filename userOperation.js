/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
var LocalCache = require('@serverless-dns/cache-wrapper').LocalCache
class UserOperation {
    constructor() {
        this.userConfigCache = new LocalCache("User-Config-Cache", 1000, 500, 5)
        this.onInvalidFlagStopProcessing = CF_ON_INVALID_FLAG_STOPPROCESSING || true
        this.dnsResolverUrl = CF_DNS_RESOLVER_URL
    }
    /*
    param.event
    param.blocklistFilter
    */
    async RethinkModule(param) {
        return loadUser.call(this, param)
    }
}


function loadUser(param) {
    
    let response = {}
    response.isException = false
    response.exceptionStack = ""
    response.exceptionFrom = ""
    response.data = {}
    try {
        let userBlocklistInfo = {}
        userBlocklistInfo.from = "Cache"
        let blocklistFlag = getBlocklistFlag(param.event.request.url)
        let currentUser = this.userConfigCache.Get(blocklistFlag)
        if (!currentUser) {
            currentUser = {}
            currentUser.k = blocklistFlag
            currentUser.data = {}
            currentUser.data.userBlocklistFlagUint = ""
            currentUser.data.flagVersion = 0
            currentUser.data.userServiceListUint = false
            currentUser.data.isValidFlag = true
            currentUser.data.isEmptyFlag = false

            let response = param.blocklistFilter.userB64FlagProcess(blocklistFlag)
            currentUser.data.userBlocklistFlagUint = response.userBlocklistFlagUint
            currentUser.data.isValidFlag = response.isValidFlag
            currentUser.data.flagVersion = response.flagVersion
            currentUser.data.isEmptyFlag = response.isEmptyFlag

            if (currentUser.data.isValidFlag) {
                currentUser.data.userServiceListUint = param.blocklistFilter.flagIntersection(currentUser.data.userBlocklistFlagUint, param.blocklistFilter.wildCardUint)
            }
            userBlocklistInfo.from = "Generated"
        }
        userBlocklistInfo.userBlocklistFlagUint = currentUser.data.userBlocklistFlagUint
        userBlocklistInfo.isValidFlag = currentUser.data.isValidFlag
        userBlocklistInfo.flagVersion = currentUser.data.flagVersion
        userBlocklistInfo.isEmptyFlag = currentUser.data.isEmptyFlag
        userBlocklistInfo.userServiceListUint = currentUser.data.userServiceListUint
        userBlocklistInfo.dnsResolverUrl = this.dnsResolverUrl

        response.data = userBlocklistInfo
        this.userConfigCache.Put(currentUser, param.event)
    }
    catch (e) {
        response.isException = true
        response.exceptionStack = e.stack
        response.exceptionFrom = "UserOperation loadUser"
        response.data = false
    }
    return response
}

function getBlocklistFlag(url) {
    let blocklistFlag = ""
    let reqUrl = new URL(url)
    let tmpsplit = reqUrl.pathname.split('/')
    if (tmpsplit.length > 1) {
        if (tmpsplit[1].toLowerCase() == "dns-query") {
            blocklistFlag = tmpsplit[2] || ""
        }
        else {
            blocklistFlag = tmpsplit[1] || ""
        }
    }
    return blocklistFlag
}

module.exports.UserOperation = UserOperation
