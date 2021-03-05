/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

class UserOperation {
    constructor() {

    }

    async RethinkModule(commonContext, thisRequest, event) {
		this.LoadUser(thisRequest, commonContext, event)
    }
    
    LoadUser(thisRequest, commonContext, event) {
        try {

            if (thisRequest.UserConfig == false) {
                thisRequest.AddFlow("New User Config Loaded")
                thisRequest.UserConfig = {}
                thisRequest.UserConfig.k = thisRequest.UserId
                thisRequest.UserConfig.data = {}
                thisRequest.UserConfig.data.userBlocklistFlagUint = ""
                thisRequest.UserConfig.data.flagVersion = 0
                thisRequest.UserConfig.data.IsServiceListEnabled = false
                thisRequest.UserConfig.data.userServiceListUint = ""
                thisRequest.UserConfig.data.isValidFlag = true

                let response = commonContext.BlockListFilter.Blocklist.userB64FlagProcess(thisRequest.UserId)
                thisRequest.UserConfig.data.userBlocklistFlagUint = response.userBlocklistFlagUint
                thisRequest.UserConfig.data.isValidFlag = response.isValidFlag
                thisRequest.UserConfig.data.flagVersion = response.flagVersion

                if(thisRequest.UserConfig.data.isValidFlag){
                    thisRequest.UserConfig.data.userServiceListUint = commonContext.BlockListFilter.Blocklist.flagIntersection(thisRequest.UserConfig.data.userBlocklistFlagUint,commonContext.GlobalContext.wildcardUint)
                    if(thisRequest.UserConfig.data.userServiceListUint != false){
                        thisRequest.UserConfig.data.IsServiceListEnabled = true
                    }
                }
                else{
                    if(commonContext.GlobalContext.CFmember.onInvalidFlagStopProcessing == true){
                        thisRequest.StopProcessing = true
                        thisRequest.IsInvalidFlagBlock = true
                    }
                }
            }
            else {
                thisRequest.AddFlow("User Config From Cache")
            }
            commonContext.UserConfigCache.Put(thisRequest.UserConfig, event)
        }
        catch (e) {
            thisRequest.StopProcessing = true
            thisRequest.IsException = true
            thisRequest.exception = e
            thisRequest.exceptionFrom = "UserOperation.js UserOperation LoadUser"
        }
    }
}


module.exports.UserOperation = UserOperation
