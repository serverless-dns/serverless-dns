/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as bufutil from "../commons/bufutil.js";
import * as dnsutil from "../commons/dnsutil.js";
import * as util from "../commons/util.js";

export default class IOState {
  constructor() {
    this.flag = "";
    this.decodedDnsPacket = this.emptyDecodedDnsPacket();
    this.httpResponse = undefined;
    this.isException = false;
    this.exceptionStack = undefined;
    this.exceptionFrom = "";
    this.isDnsBlock = false;
    this.stopProcessing = false;
    this.log = log.withTags("IOState");
  }

  id(rxid) {
    this.log.tag(rxid);
  }

  emptyDecodedDnsPacket() {
    return { id: null, questions: null };
  }

  initDecodedDnsPacketIfNeeded() {
    if (!this.decodedDnsPacket) {
      this.decodedDnsPacket = this.emptyDecodedDnsPacket();
    }
  }

  dnsExceptionResponse(res) {
    this.initDecodedDnsPacketIfNeeded();

    this.stopProcessing = true;
    this.isException = true;

    if (util.emptyObj(res)) {
      this.exceptionStack = "no-res";
      this.exceptionFrom = "no-res";
    } else {
      this.exceptionStack = res.exceptionStack || "no-stack";
      this.exceptionFrom = res.exceptionFrom || "no-origin";
    }

    const qid = this.decodedDnsPacket.id;
    const questions = this.decodedDnsPacket.questions;
    const servfail = dnsutil.servfail(qid, questions);
    const ex = {
      exceptionFrom: this.exceptionFrom,
      exceptionStack: this.exceptionStack,
    };

    this.httpResponse = new Response(servfail, {
      headers: util.concatHeaders(
        this.headers(servfail),
        this.additionalHeader(JSON.stringify(ex))
      ),
      status: servfail ? 200 : 408, // rfc8484 section-4.2.1
    });
  }

  hResponse(r) {
    if (util.emptyObj(r)) {
      this.log.w("no http-res to set, empty obj?", r);
      return;
    }

    this.httpResponse = r;
    this.stopProcessing = true;
  }

  /**
   * @param {ArrayBuffer} arrayBuffer - responseBodyBuffer
   * @returns Web API Response
   */
  dnsResponse(arrayBuffer, dnsPacket = null, blockflag = null) {
    if (bufutil.emptyBuf(arrayBuffer)) {
      return;
    }

    this.stopProcessing = true;
    this.decodedDnsPacket = dnsPacket || dnsutil.decode(arrayBuffer);
    this.flag = blockflag || "";
    this.httpResponse = new Response(arrayBuffer, {
      headers: this.headers(arrayBuffer),
    });
  }

  dnsBlockResponse(blockflag) {
    this.initDecodedDnsPacketIfNeeded();
    this.stopProcessing = true;
    this.isDnsBlock = true;
    this.flag = blockflag;

    try {
      if (util.emptyObj(this.decodedDnsPacket.questions)) {
        throw new Error("decoded dns packet missing");
      }
      this.decodedDnsPacket.type = "response";
      this.decodedDnsPacket.rcode = "NOERROR";
      // TODO: what is flag(384) 0b_0000_0000_1100_0000?
      this.decodedDnsPacket.flags = 384;
      this.decodedDnsPacket.flag_qr = true;
      this.decodedDnsPacket.answers = [];
      this.decodedDnsPacket.answers[0] = {};
      this.decodedDnsPacket.answers[0].name =
        this.decodedDnsPacket.questions[0].name;
      this.decodedDnsPacket.answers[0].type =
        this.decodedDnsPacket.questions[0].type;
      // TODO: make ttl here configurable?
      // 5m, the default ttl for blocked responses
      this.decodedDnsPacket.answers[0].ttl = 300;
      this.decodedDnsPacket.answers[0].class = "IN";
      this.decodedDnsPacket.answers[0].data = "";
      this.decodedDnsPacket.answers[0].flush = false;

      // TODO: move record-type checks (A/AAAA/SVCB) to dnsutil
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

      const b = dnsutil.encode(this.decodedDnsPacket);
      this.httpResponse = new Response(b, {
        headers: this.headers(b),
      });
    } catch (e) {
      this.log.e("dnsBlock", JSON.stringify(this.decodedDnsPacket), e.stack);
      this.isException = true;
      this.exceptionStack = e.stack;
      this.exceptionFrom = "IOState:dnsBlockResponse";
      this.httpResponse = new Response(null, {
        headers: util.concatHeaders(
          this.headers(),
          this.additionalHeader(JSON.stringify(this.exceptionStack))
        ),
        status: 503,
      });
    }
  }

  headers(b = null) {
    const xNileFlags = this.isDnsBlock ? { "x-nile-flags": this.flag } : null;
    const xNileFlagsOk = !xNileFlags ? { "x-nile-flags-dn": this.flag } : null;

    return util.concatHeaders(
      util.dnsHeaders(),
      util.contentLengthHeader(b),
      xNileFlags,
      xNileFlagsOk
    );
  }

  additionalHeader(json) {
    if (!json) return null;

    return {
      "x-nile-add": json,
    };
  }

  setCorsHeadersIfNeeded() {
    // CORS headers are only allowed when response OK
    // fetch.spec.whatwg.org/#cors-preflight-fetch (Step 7)
    if (util.emptyObj(this.httpResponse) || !this.httpResponse.ok) return;

    for (const [k, v] of Object.entries(util.corsHeaders())) {
      this.httpResponse.headers.set(k, v);
    }
  }
}
