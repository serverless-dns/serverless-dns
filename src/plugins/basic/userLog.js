/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

export class Log {
  constructor() {}
  async RethinkModule(commonContext, thisRequest, event) {
    if (!thisRequest.IsException) {
      const log = new RequestLogStructure(thisRequest, commonContext);
      commonContext.RequestLogs.push(log);
      if (!commonContext.RequestLogThreadBlock) {
        commonContext.RequestLogThreadBlock = true;
        event.waitUntil(requestLogSafeAdd.call(this, commonContext));
      }
    }
  }
}

const sleep = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

async function requestLogSafeAdd(commonContext) {
  try {
    await sleep(commonContext.GlobalContext.CFmember.dnsLogWaitTime);
    const logJSONString = JSON.stringify(commonContext.RequestLogs);
    commonContext.RequestLogs = [logJSONString];
    commonContext.RequestLogThreadBlock = true;
  } catch (e) {
    commonContext.RequestLogThreadBlock = true;
    const errobj = {
      errat: "UserLog.js requestLogSafeAdd",
      errmsg: e.stack,
    };
    commonContext.ErrorLogs.push(errobj);
  }
}

class RequestLogStructure {
  constructor(thisRequest, commonContext) {
    this.uid = thisRequest.UserId;
    this.did = thisRequest.DeviceId;
    this.bid = commonContext.GetBucketId(thisRequest.UserId);
    this.pid = commonContext.GlobalContext.processId;
    this.res1 = ""; // reserved field1
    this.res2 = ""; // reserved field2
    this.res3 = ""; // reserved field3

    // process start date time: 2022-01-07T17:33:11.400Z
    this.dt = thisRequest.startTime
      .toISOString()
      .split(".")[0]
      .split("T")
      .join(" ");
    this.dn = thisRequest.DomainName;
    this.isb = false;
    this.bl = [];

    if (thisRequest.IsDnsBlock || thisRequest.IsCnameDnsBlock) {
      this.isb = true;
      this.bl = thisRequest.responseBlocklistTag;
    }
    this.iswhite = false; // is domain name whitelisted
    this.istime = false; // is domain name blocked by time-based rules
    this.isrewrite = false; // is domain name response rewritten

    this.ct = thisRequest.httpRequest.cf.country || "na";
    this.co = thisRequest.httpRequest.cf.colo || "na";
    //  domain name retrieval from ('filter' | 'cache')
    this.dnfrm = thisRequest.domainNameFrom;

    this.time = new Date() - thisRequest.startTime;

    this.questions = thisRequest.DecodedDnsPacket.questions[0];
    this.answers = thisRequest.DecodedDnsPacket.answers;
    this.cfip = thisRequest.httpRequest.headers.get("CF-Connecting-IP");
  }
}
