/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as bufutil from "../commons/bufutil.js";
import * as dnsutil from "../commons/dnsutil.js";
import * as envutil from "../commons/envutil.js";
import * as util from "../commons/util.js";

export default class IOState {
  constructor() {
    /** @type {string} */
    this.flag = "";
    /** @type {any} */
    this.decodedDnsPacket = this.emptyDecodedDnsPacket();
    /** @type {Response?} */
    this.httpResponse = null;
    /** @type {boolean} */
    this.isProd = envutil.isProd();
    /** @type {boolean} */
    this.isException = false;
    /** @type {string} */
    this.exceptionStack = null;
    /** @type {string} */
    this.exceptionFrom = "";
    /** @type {boolean} */
    this.isDnsBlock = false;
    /** @type {boolean} */
    this.alwaysGatewayAnswer = false;
    /** @type {string} */
    this.gwip4 = "";
    /** @type {string} */
    this.gwip6 = "";
    /** @type {string} */
    this.region = "";
    /** @type {boolean} */
    this.stopProcessing = false;
    this.log = log.withTags("IOState");
  }

  id(rxid, region) {
    this.log.tag(rxid);
    this.region = region;
  }

  input(packet) {
    this.decodedDnsPacket = packet;
  }

  gatewayAnswersOnly(ip4, ip6) {
    if (util.emptyString(ip4) || util.emptyString(ip6)) {
      this.alwaysGatewayAnswer = false;
      this.log.w("none of the gw ans can be empty:", ip4, ip6);
      return;
    }
    this.alwaysGatewayAnswer = true;
    this.gwip4 = ip4;
    this.gwip6 = ip6;
    this.log.d("gateway ips set to", ip4, ip6);
  }

  emptyDecodedDnsPacket() {
    return { id: null, questions: null };
  }

  initDecodedDnsPacketIfNeeded() {
    if (!this.decodedDnsPacket) {
      this.decodedDnsPacket = this.emptyDecodedDnsPacket();
      return true;
    }
    return false;
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

    try {
      const qid = this.decodedDnsPacket.id; // may be null
      const questions = this.decodedDnsPacket.questions; // may be null
      const servfail = dnsutil.servfail(qid, questions); // may be empty
      const hasServfail = !bufutil.emptyBuf(servfail);
      const ex = {
        exceptionFrom: this.exceptionFrom,
        exceptionStack: this.exceptionStack,
      };

      if (hasServfail) {
        // TODO: try-catch as decode may throw?
        this.decodedDnsPacket = dnsutil.decode(servfail);
      }

      this.logDnsPkt();
      this.httpResponse = new Response(servfail, {
        headers: util.concatHeaders(
          this.headers(servfail),
          this.debugHeaders(JSON.stringify(ex))
        ),
        status: hasServfail ? 200 : 408, // rfc8484 section-4.2.1
      });
    } catch (e) {
      const pktjson = JSON.stringify(this.decodedDnsPacket || {});
      this.log.e("dnsExceptionResponse", pktjson, e.stack);
      if (
        this.exceptionStack === "no-res" ||
        this.exceptionStack === "no-stack"
      ) {
        this.exceptionStack = e.stack;
        this.exceptionFrom = "IOState:errorResponse";
      }
      this.httpResponse = new Response(null, {
        headers: util.concatHeaders(
          this.headers(),
          this.debugHeaders(JSON.stringify(this.exceptionStack))
        ),
        status: 503,
      });
    }
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
    this.flag = blockflag || "";

    // gw responses only assigned on A/AAAA/HTTPS/SVCB records
    // TODO: ALT-SVC records
    const isGwAns = this.assignGatewayResponseIfNeeded();
    if (isGwAns) {
      // overwrite the existing packet (raw) as in the new decoded-packed
      arrayBuffer = dnsutil.encode(this.decodedDnsPacket);
    } else {
      // overwrite the existing packet (decoded) as in the sent array-buffer
      this.decodedDnsPacket = dnsPacket || dnsutil.decode(arrayBuffer);
    }

    this.logDnsPkt();
    this.httpResponse = new Response(arrayBuffer, {
      headers: this.headers(arrayBuffer),
    });
  }

  logDnsPkt() {
    if (this.isProd) return;
    this.log.d(
      "domains",
      dnsutil.extractDomains(this.decodedDnsPacket),
      dnsutil.getQueryType(this.decodedDnsPacket) || "",
      "data",
      dnsutil.getInterestingAnswerData(this.decodedDnsPacket),
      dnsutil.ttl(this.decodedDnsPacket)
    );
  }

  dnsBlockResponse(blockflag) {
    this.initDecodedDnsPacketIfNeeded(); // initializes to empty obj
    this.stopProcessing = true;
    this.isDnsBlock = true;
    this.flag = blockflag;

    try {
      this.assignBlockResponse();
      const b = dnsutil.encode(this.decodedDnsPacket); // may throw if empty or malformed
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
          this.debugHeaders(JSON.stringify(this.exceptionStack))
        ),
        status: 503,
      });
    }
  }

  dnsNxDomainResponse() {
    this.initDecodedDnsPacketIfNeeded();
    this.stopProcessing = true;
    this.isDnsBlock = true;

    try {
      this.assignNxDomainResponse();
      const b = dnsutil.encode(this.decodedDnsPacket);
      this.httpResponse = new Response(b, {
        headers: this.headers(b),
      });
    } catch (e) {
      this.log.e("nxdomain", JSON.stringify(this.decodedDnsPacket), e.stack);
      this.isException = true;
      this.exceptionStack = e.stack;
      this.exceptionFrom = "IOState:dnsNxDomainResponse";
      this.httpResponse = new Response(null, {
        headers: util.concatHeaders(
          this.headers(),
          this.debugHeaders(JSON.stringify(this.exceptionStack))
        ),
        status: 503,
      });
    }
  }

  headers(b = null) {
    const hasBlockFlag = !util.emptyString(this.flag);
    const isBlocked = hasBlockFlag && this.isDnsBlock;
    const couldBlock = hasBlockFlag && !this.isDnsBlock;
    const xNileFlags = isBlocked ? { "x-nile-flags": this.flag } : null;
    const xNileFlagsOk = couldBlock ? { "x-nile-flags-dn": this.flag } : null;
    const xNileRegion = !util.emptyString(this.region)
      ? { "x-nile-region": this.region }
      : null;

    return util.concatHeaders(
      util.dnsHeaders(),
      util.contentLengthHeader(b),
      this.cacheHeaders(),
      xNileRegion,
      xNileFlags,
      xNileFlagsOk
    );
  }

  debugHeaders(json) {
    if (this.isProd) return null;
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

  // set cache from ttl in decoded-dns-packet
  cacheHeaders() {
    const ttl = dnsutil.ttl(this.decodedDnsPacket);
    if (ttl <= 0) return null;

    return {
      "cache-control": "public, max-age=" + ttl,
    };
  }

  assignBlockResponse() {
    let done = this.initFlagsAndAnswers();
    done = done && this.addData();
    done = done && this.wipeAuthorities();
    if (!done) throw new Error("fail assign block-response");
  }

  assignGatewayResponseIfNeeded() {
    let done = false;
    if (!this.alwaysGatewayAnswer) return done;

    done = this.initFlagsAndAnswers(60);
    done = done && this.addData(this.gwip4, this.gwip6);
    done = done && this.wipeAuthorities();

    return done;
  }

  // builds nxdomain response only for undelegated domains
  // like .internal / .local .lan
  assignNxDomainResponse() {
    if (util.emptyObj(this.decodedDnsPacket.questions)) {
      this.log.e("decoded dns-packet missing question");
      return false;
    }

    this.decodedDnsPacket.type = "response";
    this.decodedDnsPacket.rcode = "NXDOMAIN";
    // TODO: what is flag(387) 0b_0_000_0000_1100_00011?
    this.decodedDnsPacket.flags = 387;
    this.decodedDnsPacket.flag_qr = true;
    this.decodedDnsPacket.answers = [];
    this.decodedDnsPacket.authorities = [
      {
        name: ".",
        type: "SOA",
        ttl: 86400,
        class: "IN",
        flush: false,
        data: {
          mname: "a.root-servers.net",
          rname: "nstld.verisign-grs.com",
          serial: 2022111001,
          refresh: 1800,
          retry: 900,
          expire: 604800,
          minimum: 86400,
        },
      },
    ];
  }

  initFlagsAndAnswers(ttlsec = 300) {
    if (util.emptyObj(this.decodedDnsPacket.questions)) {
      this.log.e("decoded dns-packet missing question");
      return false;
    }
    this.decodedDnsPacket.type = "response";
    this.decodedDnsPacket.rcode = "NOERROR";
    // TODO: what is flag(384) 0b0_0000_0000_1100_0000?
    this.decodedDnsPacket.flags = 384;
    this.decodedDnsPacket.flag_qr = true;
    this.decodedDnsPacket.answers = [];
    this.decodedDnsPacket.answers[0] = {};
    this.decodedDnsPacket.answers[0].name =
      this.decodedDnsPacket.questions[0].name;
    this.decodedDnsPacket.answers[0].type =
      this.decodedDnsPacket.questions[0].type;
    this.decodedDnsPacket.answers[0].ttl = ttlsec;
    this.decodedDnsPacket.answers[0].class = "IN";
    this.decodedDnsPacket.answers[0].flush = false;
    return true;
  }

  addData(ip4 = "0.0.0.0", ip6 = "::") {
    if (util.emptyString(ip4) && util.emptyString(ip6)) {
      this.log.w("either ip4/ip6 to assign ans data", ip4, ip6);
      return false;
    }
    // TODO: move record-type checks (A/AAAA/SVCB) to dnsutil
    if (this.decodedDnsPacket.questions[0].type === "A") {
      this.decodedDnsPacket.answers[0].data = ip4;
    } else if (this.decodedDnsPacket.questions[0].type === "AAAA") {
      this.decodedDnsPacket.answers[0].data = ip6;
    } else if (
      this.decodedDnsPacket.questions[0].type === "HTTPS" ||
      this.decodedDnsPacket.questions[0].type === "SVCB"
    ) {
      // set https/svcb target to the same domain as in question
      this.decodedDnsPacket.answers[0].data = {};
      this.decodedDnsPacket.answers[0].data.svcPriority = 0;
      this.decodedDnsPacket.answers[0].data.targetName = ".";
      this.decodedDnsPacket.answers[0].data.svcParams = {};
      // ground that target (domain) to 0.0.0.0
      this.decodedDnsPacket.answers[1] = {};
      this.decodedDnsPacket.answers[1].name =
        this.decodedDnsPacket.questions[0].name;
      this.decodedDnsPacket.answers[1].type = "A";
      this.decodedDnsPacket.answers[1].data = ip4;
    } else {
      this.log.i("bypass gw override: not a/aaaa/https/svcb question");
      return false;
    }

    return true;
  }

  wipeAuthorities() {
    this.decodedDnsPacket.authorities = [];
    return true;
  }
}
