/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

class Log {
    constructor() {

    }
    async RethinkModule(commonContext, thisRequest, event) {
        if (thisRequest.IsException == false) {
            let log = new RequestLogStructure(thisRequest, commonContext)
            commonContext.RequestLogs.push(log)
            if (commonContext.RequestLogThreadBlock == false) {
                commonContext.RequestLogThreadBlock = true
                event.waitUntil(requestLogSafeAdd.call(this, commonContext))
            }
        }
        else {

        }
    }
}

const sleep = ms => {
	return new Promise(resolve => {
		setTimeout(resolve, ms);
	});
};

async function requestLogSafeAdd(commonContext) {
    try {
        await sleep(commonContext.GlobalContext.CFmember.dnsLogWaitTime);
        var logJSONString = ""        
        logJSONString = JSON.stringify(commonContext.RequestLogs)
        commonContext.RequestLogs = []
        commonContext.RequestLogThreadBlock = true
      }
      catch (e) {
        commonContext.RequestLogThreadBlock = true
        let errobj = {}
        errobj.errat = "UserLog.js requestLogSafeAdd"
        errobj.errmsg = e.stack
        commonContext.ErrorLogs.push(errobj)
      }
}

class RequestLogStructure {
    constructor(thisRequest, commonContext) {
        this.uid = thisRequest.UserId //user id
        this.did = thisRequest.DeviceId //device id
        this.bid = commonContext.GetBucketId(thisRequest.UserId)//ord[uid[uid.length-1]] bucket id
        this.pid = commonContext.GlobalContext.processId //process id
        this.res1 = "" //reserve field1
        this.res2 = "" //reserve field2
        this.res3 = "" //reserve field3

        this.dt = thisRequest.startTime.toISOString().split(".")[0].split("T").join(" ") //process start date time
        this.dn = thisRequest.DomainName //resolve domain name
        this.isb = false //is domain name blocked by process
        this.bl = [] //domain name blocked list

        if (thisRequest.IsDnsBlock == true || thisRequest.IsCnameDnsBlock == true) {
            this.isb = true
            this.bl = thisRequest.responseBlocklistTag
        }
        this.iswhite = false //is domain name white listed by process
        this.istime = false //is domain name blocked by time based process
        this.isrewrite = false //is domain name response rewritten by process


        this.ct = thisRequest.httpRequest.cf.country || "na" //requested ip country
        this.co = thisRequest.httpRequest.cf.colo || "na" //requested ip country code
        this.dnfrm = thisRequest.domainNameFrom //domain name retrieval from ('filter' | 'cache')

        this.time = (new Date()) - thisRequest.startTime //difference between start and end time

        this.questions = thisRequest.DecodedDnsPacket.questions[0] //dns question decoded list
        this.answers = thisRequest.DecodedDnsPacket.answers //dns response for question decoded list
        this.cfip = thisRequest.httpRequest.headers.get('CF-Connecting-IP') //requested ip
    }
}

module.exports.Log = Log
