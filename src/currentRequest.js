/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { DNSParserWrap as DnsParser } from "./dns-operation/dnsOperation.js";
import * as log from "./helpers/log.js";
import * as dnsutil from "./helpers/dnsutil.js";

export default class CurrentRequest {
  constructor() {
    this.blockedB64Flag = "";
    this.decodedDnsPacket = undefined;
    this.httpResponse = undefined;
    this.isException = false;
    this.exceptionStack = undefined;
    this.exceptionFrom = "";
    this.isDnsParseException = false;
    this.isDnsBlock = false;
    this.isInvalidFlagBlock = false;
    this.stopProcessing = false;
    this.dnsParser = new DnsParser();
  }

  dnsExceptionResponse() {
    const singleLog = {};
    singleLog.exceptionFrom = this.exceptionFrom;
    singleLog.exceptionStack = this.exceptionStack;
    this.httpResponse = new Response(dnsutil.servfail);
    this.setHeaders();
    this.httpResponse.headers.set("x-err", JSON.stringify(singleLog));
  }

  customResponse(data) {
    this.httpResponse = new Response(dnsutil);
    this.setHeaders();
    this.httpResponse.headers.set("x-err", JSON.stringify(data));
  }

  /**
   * @param {ArrayBuffer} arrayBuffer - responseBodyBuffer
   * @returns Web API Response
   */
  dnsResponse(arrayBuffer) {
    this.httpResponse = new Response(arrayBuffer);
    this.setHeaders();
  }
  dnsBlockResponse() {
    try {
      this.decodedDnsPacket.type = "response";
      this.decodedDnsPacket.rcode = "NOERROR";
      this.decodedDnsPacket.flags = 384;
      this.decodedDnsPacket.flag_qr = true;
      this.decodedDnsPacket.answers = [];
      this.decodedDnsPacket.answers[0] = {};
      this.decodedDnsPacket.answers[0].name =
        this.decodedDnsPacket.questions[0].name;
      this.decodedDnsPacket.answers[0].type =
        this.decodedDnsPacket.questions[0].type;
      this.decodedDnsPacket.answers[0].ttl = 300;
      this.decodedDnsPacket.answers[0].class = "IN";
      this.decodedDnsPacket.answers[0].data = "";
      this.decodedDnsPacket.answers[0].flush = false;
      if (this.decodedDnsPacket.questions[0].type == "A") {
        this.decodedDnsPacket.answers[0].data = "0.0.0.0";
      } else if(this.decodedDnsPacket.questions[0].type == "AAAA") {
        this.decodedDnsPacket.answers[0].data = "::";
      }
      else if(this.decodedDnsPacket.questions[0].type == "HTTPS" || this.decodedDnsPacket.questions[0].type == "SVCB") {
        this.decodedDnsPacket.answers[0].data = {}
        this.decodedDnsPacket.answers[0].data.svcPriority = 0;
        this.decodedDnsPacket.answers[0].data.targetName = ".";
        this.decodedDnsPacket.answers[0].data.svcParams = {};
      }
      this.decodedDnsPacket.authorities = []
      this.httpResponse = new Response(this.dnsParser.Encode(this.decodedDnsPacket));
      this.setHeaders();
    } catch (e) {
      log.e(JSON.stringify(this.decodedDnsPacket))
      this.isException = true;
      this.exceptionStack = e.stack;
      this.exceptionFrom = "CurrentRequest dnsBlockResponse";
    }
  }

  setHeaders() {
    this.httpResponse.headers.set("Content-Type", "application/dns-message");
    this.httpResponse.headers.append("Vary", "Origin");
    this.httpResponse.headers.delete("expect-ct");
    this.httpResponse.headers.delete("cf-ray");
    if(this.isDnsBlock){
      this.httpResponse.headers.set("x-nile-flags", this.blockedB64Flag);
    }
    else if(this.blockedB64Flag !== ""){
      this.httpResponse.headers.set('x-nile-flag-notblocked', this.blockedB64Flag)
    }
  }

}


