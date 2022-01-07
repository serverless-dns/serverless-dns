/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import { BlocklistWrapper } from "../blocklist-wrapper/blocklistWrapper.js";
import { CommandControl } from "../command-control/cc.js";
import { UserOperation } from "../basic/basic.js";
import {
  DNSCacheResponse,
  DNSQuestionBlock,
  DNSResolver,
  DNSResponseBlock,
} from "../dns-operation/dnsOperation.js";
import * as util from "./util.js";
import * as envutil from "./envutil.js";
import * as system from "../system.js";

import { DnsCache } from "../cache-wrapper/cache-wrapper.js";
import * as dnsutil from "./dnsutil.js";
import * as dnsBlockUtil from "./dnsblockutil.js";

const services = {};

((main) => {
  system.sub("ready", systemReady);
})();

async function systemReady() {
  if (services.ready) return;

  log.i("plugin.js: systemReady");

  services.blocklistWrapper = new BlocklistWrapper();
  services.commandControl = new CommandControl();
  services.userOperation = new UserOperation();
  services.dnsQuestionBlock = new DNSQuestionBlock();
  services.dnsResolver = new DNSResolver();
  services.dnsResponseBlock = new DNSResponseBlock();
  services.dnsCacheHandler = new DNSCacheResponse();
  services.dnsCache = new DnsCache(dnsutil.cacheSize());

  if (envutil.isNode()) {
    const blocklists = await import("./node/blocklists.js");
    await blocklists.setup(services.blocklistWrapper);
  }

  system.pub("go");

  services.ready = true;
}

export default class RethinkPlugin {
  /**
   * @param {{request: Request}} event
   */
  constructor(event) {
    /**
     * Parameters of RethinkPlugin which may be used by individual plugins.
     */
    this.parameter = new Map(envManager.getMap());

    const rxid = util.rxidFromHeader(event.request.headers) || util.xid();
    // TODO: generate rxid in setRequest instead?
    this.registerParameter("rxid", "[rxid." + rxid + "]");

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
    await setRequest(this.parameter, req);

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
    this.log.d(rxid, "blocklistFilter response");

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
    this.log.d(rxid, "commandControl response");

    if (!util.emptyObj(r) && r.stopProcessing) {
      currentRequest.httpResponse = r.httpResponse;
      currentRequest.stopProcessing = true;
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
    this.log.d(rxid, "userOperation response");

    if (response.isException) {
      this.log.w(rxid, "unexpected err userOp", r);
      this.loadException(rxid, response, currentRequest);
    } else if (!util.emptyObj(r)) {
      // r.userBlocklistInfo and r.dnsResolverUrl are never "null"
      this.registerParameter("userBlocklistInfo", r.userBlocklistInfo);
      this.registerParameter("dnsResolverUrl", r.dnsResolverUrl);
    } else {
      this.log.i(rxid, "userOp is a no-op, possibly a command control req");
    }
  }

  dnsCacheCallBack(response, currentRequest) {
    const rxid = this.parameter.get("rxid");
    const r = response.data;
    this.log.d(
      rxid,
      "dnsCacheHandler response blocked?",
      r.isBlocked,
      "answer?",
      !util.emptyBuf(r.dnsBuffer)
    );

    if (response.isException) {
      this.loadException(rxid, response, currentRequest);
    } else if (r && r.isBlocked) {
      currentRequest.isDnsBlock = r.isBlocked;
      currentRequest.blockedB64Flag = r.blockedB64Flag;
      currentRequest.stopProcessing = true;
      currentRequest.dnsBlockResponse();
    } else if (r && r.dnsBuffer) {
      this.registerParameter("responseDecodedDnsPacket", r.dnsPacket);
      currentRequest.dnsResponse(r.dnsBuffer);
      currentRequest.decodedDnsPacket = r.dnsPacket;
      currentRequest.stopProcessing = true;
    } else {
      this.log.d(rxid, "resolve query; no response from dnsCache");
    }
  }

  dnsQuestionBlockCallBack(response, currentRequest) {
    const rxid = this.parameter.get("rxid");
    const r = response.data;
    const blocked = !util.emptyObj(r) && r.isBlocked;
    this.log.d(rxid, "dnsQuestionBlock response blocked?", blocked);

    if (response.isException) {
      this.loadException(rxid, response, currentRequest);
    } else if (blocked) {
      currentRequest.isDnsBlock = r.isBlocked;
      currentRequest.blockedB64Flag = r.blockedB64Flag;
      if (currentRequest.isDnsBlock) {
        currentRequest.stopProcessing = true;
        currentRequest.dnsBlockResponse();
      }
    } else {
      this.log.d(rxid, "all okay, no actionable res from dnsQuestionBlock");
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
    this.log.d(rxid, "dnsResolver packet");

    if (
      response.isException ||
      util.emptyObj(r) ||
      util.emptyBuf(r.dnsBuffer)
    ) {
      this.log.w(rxid, "err dns resolver", response);
      this.loadException(rxid, response, currentRequest);
      return;
    }
    this.registerParameter("responseBodyBuffer", r.dnsBuffer);
    this.registerParameter("responseDecodedDnsPacket", r.dnsPacket);
  }

  /**
   * Adds "dnsCnameBlockResponse" to RethinkPlugin params
   * @param {*} response -
   * @param {*} currentRequest
   */
  dnsResponseBlockCallBack(response, currentRequest) {
    const rxid = this.parameter.get("rxid");
    const r = response.data;
    this.log.d(rxid, "dnsResponseBlock");

    // stop processing since this must be the last plugin that
    // takes any manipulative action on the dns query and answer
    currentRequest.stopProcessing = true;

    if (response.isException) {
      this.loadException(rxid, response, currentRequest);
    } else if (r && r.isBlocked) {
      currentRequest.isDnsBlock = r.isBlocked;
      // TODO: can r.blockedB64Flag be ever empty when r.isBlocked?
      currentRequest.blockedB64Flag = r.blockedB64Flag;
      currentRequest.dnsBlockResponse();
    } else {
      currentRequest.dnsResponse(this.parameter.get("responseBodyBuffer"));
      currentRequest.decodedDnsPacket = this.parameter.get(
        "responseDecodedDnsPacket"
      );
    }
  }

  loadException(rxid, response, currentRequest) {
    this.log.e(rxid, "exception", JSON.stringify(response));
    currentRequest.dnsExceptionResponse(response);
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

async function setRequest(parameter, currentRequest) {
  const request = parameter.get("request");
  const isDnsMsg = util.isDnsMsg(request);

  parameter.set("isDnsMsg", isDnsMsg);

  // nothing to do if the current request isn't a dns question
  if (!isDnsMsg) {
    // throw away any request that is not a dns-msg since cc.js
    // processes non-dns msgs only via GET, while rest of the
    // plugins process only dns-msgs via GET and POST.
    if (!util.isGetRequest(request)) setInvalidResponse(currentRequest);
    return;
  }

  const packet = await getBodyBuffer(request);
  const decodedPacket = dnsutil.decode(packet);

  currentRequest.decodedDnsPacket = decodedPacket;
  parameter.set("requestDecodedDnsPacket", decodedPacket);
  parameter.set("requestBodyBuffer", packet);
}

async function getBodyBuffer(request) {
  if (util.isPostRequest(request)) {
    return await request.arrayBuffer();
  } else {
    // TODO: okay to assume GET request?
    const queryString = new URL(request.url).searchParams;
    const dnsQuery = queryString.get("dns");
    return dnsBlockUtil.base64ToBytes(dnsQuery);
  }
}

function setInvalidResponse(currentRequest) {
  currentRequest.httpResponse = util.respond405();
  currentRequest.stopProcessing = true;
}
