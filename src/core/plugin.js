/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { services } from "./svc.js";
import * as bufutil from "../commons/bufutil.js";
import * as dnsutil from "../commons/dnsutil.js";
import * as util from "../commons/util.js";

export default class RethinkPlugin {
  /**
   * @param {{request: Request}} event
   */
  constructor(event) {
    if (!services.ready) throw new Error("services not ready");
    /**
     * Parameters of RethinkPlugin which may be used by individual plugins.
     */
    this.parameter = new Map(envManager.getMap());

    const rxid = util.rxidFromHeader(event.request.headers) || util.xid();
    // TODO: generate rxid in setRequest instead?
    this.registerParameter("rxid", "[rx." + rxid + "]");

    // caution: event isn't an event on nodejs, but event.request is a request
    this.registerParameter("event", event);
    this.registerParameter("request", event.request);

    this.registerParameter("dnsQuestionBlock", services.dnsQuestionBlock);
    this.registerParameter("dnsResponseBlock", services.dnsResponseBlock);
    this.registerParameter("dnsCache", services.dnsCache);

    this.log = log.withTags("RethinkPlugin");

    this.plugin = [];

    this.registerPlugin(
      "userOperation",
      services.userOperation,
      ["rxid", "dnsResolverUrl", "request", "isDnsMsg"],
      this.userOperationCallBack,
      false
    );

    this.registerPlugin(
      "DnsCacheHandler",
      services.dnsCacheHandler,
      [
        "rxid",
        "userBlocklistInfo",
        "request",
        "requestDecodedDnsPacket",
        "isDnsMsg",
        "dnsCache",
        "dnsQuestionBlock",
        "dnsResponseBlock",
      ],
      this.dnsCacheCallBack,
      false
    );

    this.registerPlugin(
      "blocklistFilter",
      services.blocklistWrapper,
      [
        "rxid",
        "blocklistUrl",
        "latestTimestamp",
        "workerTimeout",
        "tdParts",
        "tdNodecount",
        "fetchTimeout",
      ],
      this.blocklistFilterCallBack,
      false
    );

    this.registerPlugin(
      "commandControl",
      services.commandControl,
      ["rxid", "request", "blocklistFilter", "latestTimestamp", "isDnsMsg"],
      this.commandControlCallBack,
      false
    );

    this.registerPlugin(
      "dnsQuestionBlock",
      services.dnsQuestionBlock,
      [
        "rxid",
        "requestDecodedDnsPacket",
        "blocklistFilter",
        "userBlocklistInfo",
        "event",
        "request",
        "dnsCache",
      ],
      this.dnsQuestionBlockCallBack,
      false
    );

    this.registerPlugin(
      "dnsResolver",
      services.dnsResolver,
      [
        "rxid",
        "requestBodyBuffer",
        "request",
        "dnsResolverUrl",
        "requestDecodedDnsPacket",
        "event",
        "blocklistFilter",
        "dnsCache",
      ],
      this.dnsResolverCallBack,
      false
    );

    this.registerPlugin(
      "DNSResponseBlock",
      services.dnsResponseBlock,
      [
        "rxid",
        "userBlocklistInfo",
        "blocklistFilter",
        "responseDecodedDnsPacket",
        "responseBodyBuffer",
        "event",
        "request",
        "dnsCache",
      ],
      this.dnsResponseBlockCallBack,
      false
    );
  }

  registerParameter(k, v) {
    this.parameter.set(k, v);
  }

  registerPlugin(
    pluginName,
    module,
    parameter,
    callBack,
    continueOnStopProcess
  ) {
    this.plugin.push({
      name: pluginName,
      module: module,
      param: parameter,
      callBack: callBack,
      continueOnStopProcess: continueOnStopProcess,
    });
  }

  async executePlugin(req) {
    await this.setRequest(req);

    const rxid = this.parameter.get("rxid");

    const t = this.log.startTime("exec-plugin-" + rxid);

    for (const p of this.plugin) {
      if (req.stopProcessing && !p.continueOnStopProcess) {
        continue;
      }

      this.log.lapTime(t, rxid, p.name, "send-req");

      const res = await p.module.RethinkModule(
        generateParam(this.parameter, p.param)
      );

      this.log.lapTime(t, rxid, p.name, "got-res");

      if (p.callBack) {
        await p.callBack.call(this, res, req);
      }

      this.log.lapTime(t, rxid, p.name, "post-callback");
    }
    this.log.endTime(t);
  }

  /**
   * Adds "blocklistFilter" to RethinkPlugin params
   * @param {*} response - Contains `data` which is `blocklistFilter`
   * @param {*} currentRequest
   */
  blocklistFilterCallBack(response, currentRequest) {
    const rxid = this.parameter.get("rxid");
    const r = response.data;
    this.log.d(rxid, "blocklist-filter response");

    if (
      response.isException ||
      util.emptyObj(r) ||
      // FIXME: check if blocklist-filter has t/ft vars set?
      // ref: blocklistWrapper:isBlocklistFilterSetup
      util.emptyObj(r.blocklistFilter)
    ) {
      this.log.e(rxid, "err building blocklist-filter", response);
      this.loadException(rxid, response, currentRequest);
      return;
    }

    this.registerParameter("blocklistFilter", r.blocklistFilter);
  }

  /**
   * params
   * @param {*} response
   * @param {*} currentRequest
   */
  async commandControlCallBack(response, currentRequest) {
    const rxid = this.parameter.get("rxid");
    const r = response.data;
    this.log.d(rxid, "command-control response");

    if (!util.emptyObj(r) && r.stopProcessing) {
      currentRequest.hResponse(r.httpResponse);
    }
  }

  /**
   * Adds "userBlocklistInfo" and "dnsResolverUrl" to RethinkPlugin params
   * @param {*} response - Contains `data` which is `userBlocklistInfo`
   * @param {*} currentRequest
   */
  async userOperationCallBack(response, currentRequest) {
    const rxid = this.parameter.get("rxid");
    const r = response.data;
    this.log.d(rxid, "user-op response");

    if (response.isException) {
      this.log.w(rxid, "unexpected err userOp", r);
      this.loadException(rxid, response, currentRequest);
    } else if (!util.emptyObj(r)) {
      // r.userBlocklistInfo and r.dnsResolverUrl are never "null"
      this.registerParameter("userBlocklistInfo", r.userBlocklistInfo);
      this.registerParameter("dnsResolverUrl", r.dnsResolverUrl);
    } else {
      this.log.i(rxid, "user-op is a no-op, possibly a command-control req");
    }
  }

  dnsCacheCallBack(response, currentRequest) {
    const rxid = this.parameter.get("rxid");
    const r = response.data;
    const blocked = !util.emptyObj(r) && r.isBlocked;
    const answered = !util.emptyObj(r) && !bufutil.emptyBuf(r.dnsBuffer);
    this.log.d(rxid, "cache-handler: block?", blocked, "ans?", answered);

    if (response.isException) {
      this.loadException(rxid, response, currentRequest);
    } else if (blocked) {
      currentRequest.dnsBlockResponse(r.blockedB64Flag);
    } else if (answered) {
      this.registerParameter("responseBodyBuffer", r.dnsBuffer);
      this.registerParameter("responseDecodedDnsPacket", r.dnsPacket);
      currentRequest.dnsResponse(r.dnsBuffer, r.dnsPacket);
    } else {
      this.log.d(rxid, "resolve query; no response from cache-handler");
    }
  }

  dnsQuestionBlockCallBack(response, currentRequest) {
    const rxid = this.parameter.get("rxid");
    const r = response.data;
    const blocked = !util.emptyObj(r) && r.isBlocked;
    this.log.d(rxid, "question-block blocked?", blocked);

    if (response.isException) {
      this.loadException(rxid, response, currentRequest);
    } else if (blocked) {
      currentRequest.dnsBlockResponse(r.blockedB64Flag);
    } else {
      this.log.d(rxid, "all okay, no actionable res from question-block");
    }
  }

  /**
   * Adds "responseBodyBuffer" (arrayBuffer of dns response from upstream
   * resolver) to RethinkPlugin params
   * @param {*} response
   * @param {*} currentRequest
   */
  dnsResolverCallBack(response, currentRequest) {
    const rxid = this.parameter.get("rxid");
    const r = response.data;
    const answered = !util.emptyObj(r) && !bufutil.emptyBuf(r.dnsBuffer);
    this.log.d(rxid, "dns-resolver packet");

    if (response.isException || !answered) {
      this.log.w(rxid, "err dns-resolver", response, "ans?", answered);
      this.loadException(rxid, response, currentRequest);
      return;
    } else {
      // answered
      this.registerParameter("responseBodyBuffer", r.dnsBuffer);
      this.registerParameter("responseDecodedDnsPacket", r.dnsPacket);
      // TODO: uncomment this once cacheResponse.js and dnsResolver.js
      // have similar behaviour (that is, question and ans blocking happens
      // inside dnsResolver.js itself and not outside of it as a plugin)
      // Otherwise, currentRequest#dnsResponse sets stopProcessing to true
      // and none of the plugins hence execute.
      // currentRequest.dnsResponse(r.dnsBuffer, r.dnsPacket);
    }
  }

  /**
   * Adds "dnsCnameBlockResponse" to RethinkPlugin params
   * @param {*} response -
   * @param {*} currentRequest
   */
  dnsResponseBlockCallBack(response, currentRequest) {
    const rxid = this.parameter.get("rxid");
    const r = response.data;
    const blocked = !util.emptyObj(r) && r.isBlocked;
    this.log.d(rxid, "ans-block blocked?", blocked);

    // stop processing since this must be the last plugin that
    // takes any manipulative action on the dns query and answer
    currentRequest.stopProcessing = true;

    if (response.isException) {
      this.loadException(rxid, response, currentRequest);
    } else if (blocked) {
      // TODO: can r.blockedB64Flag be ever empty when r.isBlocked?
      currentRequest.dnsBlockResponse(r.blockedB64Flag);
    } else {
      const dnsBuffer = this.parameter.get("responseBodyBuffer");
      const dnsPacket = this.parameter.get("responseDecodedDnsPacket");
      currentRequest.dnsResponse(dnsBuffer, dnsPacket);
    }
  }

  loadException(rxid, response, currentRequest) {
    this.log.e(rxid, "exception", JSON.stringify(response));
    currentRequest.dnsExceptionResponse(response);
  }

  async setRequest(currentRequest) {
    const request = this.parameter.get("request");
    const isDnsMsg = util.isDnsMsg(request);
    const rxid = this.parameter.get("rxid");

    currentRequest.id(rxid);

    this.registerParameter("isDnsMsg", isDnsMsg);

    // nothing to do if the current request isn't a dns question
    if (!isDnsMsg) {
      // throw away any request that is not a dns-msg since cc.js
      // processes non-dns msgs only via GET, while rest of the
      // plugins process only dns-msgs via GET and POST.
      if (!util.isGetRequest(request)) setInvalidResponse(currentRequest);
      return;
    }

    const question = await extractDnsQuestion(request);
    const questionPacket = dnsutil.decode(question);

    this.log.d(rxid, "cur-ques", JSON.stringify(questionPacket.questions));

    currentRequest.decodedDnsPacket = questionPacket;
    this.registerParameter("requestDecodedDnsPacket", questionPacket);
    this.registerParameter("requestBodyBuffer", question);
  }
}

/**
 * Retrieves parameters of a plugin
 * @param {String[]} list - Parameters of a plugin
 * @returns - Object of plugin parameters
 */
function generateParam(parameter, list) {
  const out = {};
  for (const key of list) {
    out[key] = parameter.get(key) || null;
  }
  return out;
}

async function extractDnsQuestion(request) {
  if (util.isPostRequest(request)) {
    return await request.arrayBuffer();
  } else {
    // TODO: okay to assume GET request?
    const queryString = new URL(request.url).searchParams;
    const dnsQuery = queryString.get("dns");
    return bufutil.base64ToBytes(dnsQuery);
  }
}

function setInvalidResponse(currentRequest) {
  currentRequest.hResponse(util.respond405());
}
