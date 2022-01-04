/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as dnsutil from "../helpers/dnsutil.js";
import * as util from "../helpers/util.js";

export default class CurrentRequest {
  constructor() {
    this.blockedB64Flag = "";
    this.decodedDnsPacket = this.emptyDecodedDnsPacket();
    this.httpResponse = undefined;
    this.isException = false;
    this.exceptionStack = undefined;
    this.exceptionFrom = "";
    this.isDnsParseException = false;
    this.isDnsBlock = false;
    this.isInvalidFlagBlock = false;
    this.stopProcessing = false;
    this.log = log.withTags("CurrentRequest");
  }

  emptyDecodedDnsPacket() {
    return { id: 0, questions: null };
  }

  initDecodedDnsPacketIfNeeded() {
    if (!this.decodedDnsPacket) {
      this.decodedDnsPacket = this.emptyDecodedDnsPacket();
    }
  }

  dnsExceptionResponse() {
    this.initDecodedDnsPacketIfNeeded();

    const qid = this.decodedDnsPacket.id;
    const questions = this.decodedDnsPacket.questions;
    const ex = {
      exceptionFrom: this.exceptionFrom,
      exceptionStack: this.exceptionStack,
    };
    const servfail = dnsutil.servfail(qid, questions);
    this.httpResponse = new Response(servfail, {
      headers: util.concatHeaders(
        this.headers(),
        this.additionalHeader(JSON.stringify(ex))
      ),
      status: servfail ? 200 : 500, // rfc8484 section-4.2.1
    });
  }

  customResponse(x) {
    this.httpResponse = new Response(null, {
      headers: util.concatHeaders(
        this.headers(),
        this.additionalHeader(JSON.stringify(x))
      ),
    });
  }

  /**
   * @param {ArrayBuffer} arrayBuffer - responseBodyBuffer
   * @returns Web API Response
   */
  dnsResponse(arrayBuffer) {
    this.httpResponse = new Response(arrayBuffer, { headers: this.headers() });
  }

  dnsBlockResponse() {
    this.initDecodedDnsPacketIfNeeded();
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
      if (this.decodedDnsPacket.questions[0].type === "A") {
        this.decodedDnsPacket.answers[0].data = "0.0.0.0";
      } else if (this.decodedDnsPacket.questions[0].type === "AAAA") {
        this.decodedDnsPacket.answers[0].data = "::";
      } else if (
        this.decodedDnsPacket.questions[0].type === "HTTPS" ||
        this.decodedDnsPacket.questions[0].type === "SVCB"
      ) {
        this.decodedDnsPacket.answers[0].data = {};
        this.decodedDnsPacket.answers[0].data.svcPriority = 0;
        this.decodedDnsPacket.answers[0].data.targetName = ".";
        this.decodedDnsPacket.answers[0].data.svcParams = {};
      }
      this.decodedDnsPacket.authorities = [];
      this.httpResponse = new Response(dnsutil.encode(this.decodedDnsPacket), {
        headers: this.headers(),
      });
    } catch (e) {
      this.log.e(JSON.stringify(this.decodedDnsPacket));
      this.isException = true;
      this.exceptionStack = e.stack;
      this.exceptionFrom = "CurrentRequest dnsBlockResponse";
    }
  }

  headers() {
    const xNileFlags = this.isDnsBlock
      ? { "x-nile-flags": this.blockedB64Flag }
      : null;
    const xNileFlagsAllowed = this.blockedB64Flag
      ? { "x-nile-flags-allowed": this.blockedB64Flag }
      : null;

    return util.concatHeaders(util.dnsHeaders(), xNileFlags, xNileFlagsAllowed);
  }

  additionalHeader(json) {
    if (!json) return null;

    return {
      "x-nile-add": json,
    };
  }

  setCorsHeaders() {
    // CORS headers are only allowed on ok status.
    // https://fetch.spec.whatwg.org/#cors-preflight-fetch (Step 7)
    if (this.httpResponse.ok) {
      for (const [name, value] of Object.entries(util.corsHeaders())) {
        this.httpResponse.headers.set(name, value);
      }
    }
  }
}
