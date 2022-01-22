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
    this.registerParameter("rxid", "[rx." + rxid + "]");

    // caution: event isn't an event on nodejs, but event.request is a request
    this.registerParameter("request", event.request);
    // TODO: a more generic way for plugins to queue events on all platforms
    // dispatcher fn when called, fails with 'illegal invocation' if not
    // bound explicitly to 'event' (since it then executes in the context
    // of which-ever obj calls it): stackoverflow.com/a/9678166
    this.registerParameter("dispatcher", event.waitUntil.bind(event));

    this.log = log.withTags("RethinkPlugin");

    this.plugin = [];

    this.registerPlugin(
      "userOperation",
      services.userOperation,
      ["rxid", "request", "isDnsMsg"],
      this.userOperationCallBack,
      false
    );

    this.registerPlugin(
      "cacheOnlyResolver",
      services.dnsCacheHandler,
      ["rxid", "userBlocklistInfo", "requestDecodedDnsPacket", "isDnsMsg"],
      this.dnsCacheCallBack,
      false
    );

    this.registerPlugin(
      "blocklistFilter",
      services.blocklistWrapper,
      ["rxid"],
      this.blocklistFilterCallBack,
      false
    );

    this.registerPlugin(
      "commandControl",
      services.commandControl,
      ["rxid", "request", "blocklistFilter", "isDnsMsg"],
      this.commandControlCallBack,
      false
    );

    this.registerPlugin(
      "dnsResolver",
      services.dnsResolver,
      [
        "rxid",
        "dispatcher",
        "request",
        "userDnsResolverUrl",
        // resolver-url overriden by user-op
        "userBlocklistInfo",
        "blocklistFilter",
        "requestBodyBuffer",
      ],
      this.dnsResolverCallBack,
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
      this.registerParameter("userDnsResolverUrl", r.dnsResolverUrl);
    } else {
      this.log.i(rxid, "user-op is a no-op, possibly a command-control req");
    }
  }

  dnsCacheCallBack(response, currentRequest) {
    const rxid = this.parameter.get("rxid");
    const r = response.data;
    const blocked = r.isBlocked;
    // if cache doesn't contain an answer section, upstream the query
    // since cache doesn't store non-answers like servfail / nxdomains
    const answered = dnsutil.hasAnswers(r.dnsPacket);
    this.log.d(rxid, "cache-handler: block?", blocked, "ans?", answered);

    if (response.isException) {
      this.loadException(rxid, response, currentRequest);
    } else if (blocked) {
      // TODO: create block packets/buffers in dnsBlocker.js
      currentRequest.dnsBlockResponse(r.blockedB64Flag);
    } else if (answered) {
      this.registerParameter("responseBodyBuffer", r.dnsBuffer);
      this.registerParameter("responseDecodedDnsPacket", r.dnsPacket);
      currentRequest.dnsResponse(r.dnsBuffer, r.dnsPacket, r.blockedB64Flag);
    } else {
      this.log.d(rxid, "resolve query; no response from cache-handler");
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
    const blocked = r.isBlocked;
    // dns packets may have no answers, but still be a valid response
    // for example, servfail do not contain any answers, whereas
    // nxdomain has an authority-section (but no answers).
    const answered = dnsutil.hasAnswers(r.dnsPacket);
    this.log.d(rxid, "resolver: block?", blocked, "ans?", answered);

    if (response.isException) {
      this.loadException(rxid, response, currentRequest);
    } else if (blocked) {
      // TODO: create block packets/buffers in dnsBlocker.js
      currentRequest.dnsBlockResponse(r.blockedB64Flag);
    } else {
      this.registerParameter("responseBodyBuffer", r.dnsBuffer);
      this.registerParameter("responseDecodedDnsPacket", r.dnsPacket);
      currentRequest.dnsResponse(r.dnsBuffer, r.dnsPacket, r.blockedB64Flag);
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
