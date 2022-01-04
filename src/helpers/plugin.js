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
import * as dnsutil from "../helpers/dnsutil.js";

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
      ["dnsResolverUrl", "request", "isDnsMsg"],
      this.userOperationCallBack,
      false
    );

    this.registerPlugin(
      "AggressiveCaching",
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
      this.dnsAggCacheCallBack,
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
    this.log.d(rxid, "In blocklistFilterCallBack");

    if (response.isException) {
      loadException(response, currentRequest);
    } else {
      this.registerParameter("blocklistFilter", response.data.blocklistFilter);
    }
  }

  /**
   * params
   * @param {*} response
   * @param {*} currentRequest
   */
  async commandControlCallBack(response, currentRequest) {
    const rxid = this.parameter.get("rxid");
    this.log.d(rxid, "In commandControlCallBack");

    if (response.data.stopProcessing) {
      currentRequest.httpResponse = response.data.httpResponse;
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
    this.log.d(rxid, "In userOperationCallBack");

    if (response.isException) {
      loadException(response, currentRequest);
    } else {
      this.registerParameter(
        "userBlocklistInfo",
        response.data.userBlocklistInfo
      );
      this.registerParameter("dnsResolverUrl", response.data.dnsResolverUrl);
    }
  }

  dnsAggCacheCallBack(response, currentRequest) {
    const rxid = this.parameter.get("rxid");
    this.log.d(rxid, "In dnsAggCacheCallBack");

    if (response.isException) {
      loadException(response, currentRequest);
    } else if (response.data && response.data.isBlocked) {
      currentRequest.isDnsBlock = response.data.isBlocked;
      currentRequest.blockedB64Flag = response.data.blockedB64Flag;
      currentRequest.stopProcessing = true;
      currentRequest.dnsBlockResponse();
    } else if (response.data && response.data.dnsBuffer) {
      this.registerParameter(
        "responseDecodedDnsPacket",
        response.data.dnsPacket
      );
      currentRequest.dnsResponse(response.data.dnsBuffer);
      currentRequest.decodedDnsPacket = response.data.dnsPacket;
      currentRequest.stopProcessing = true;
    }
  }

  dnsQuestionBlockCallBack(response, currentRequest) {
    const rxid = this.parameter.get("rxid");
    this.log.d(rxid, "In dnsQuestionBlockCallBack");

    if (response.isException) {
      loadException(response, currentRequest);
    } else if (response.data) {
      currentRequest.isDnsBlock = response.data.isBlocked;
      currentRequest.blockedB64Flag = response.data.blockedB64Flag;
      if (currentRequest.isDnsBlock) {
        currentRequest.stopProcessing = true;
        currentRequest.dnsBlockResponse();
      }
    }
  }

  /**
   * Adds "responseBodyBuffer" (arrayBuffer of dns response from upstream
   * resolver) to RethinkPlugin params
   * @param {*} response
   * @param {*} currentRequest
   */
  dnsResolverCallBack(response, currentRequest) {
    this.log.d(
      this.parameter.get("rxid"),
      "In dnsResolverCallBack",
      JSON.stringify(response.data)
    );

    if (response.isException) {
      loadException(response, currentRequest);
    } else {
      this.registerParameter("responseBodyBuffer", response.data.dnsBuffer);

      this.registerParameter(
        "responseDecodedDnsPacket",
        response.data.dnsPacket
      );
    }
  }

  /**
   * Adds "dnsCnameBlockResponse" to RethinkPlugin params
   * @param {*} response -
   * @param {*} currentRequest
   */
  dnsResponseBlockCallBack(response, currentRequest) {
    const rxid = this.parameter.get("rxid");
    this.log.d(rxid, "In dnsResponseBlockCallBack");

    if (response.isException) {
      loadException(response, currentRequest);
    } else if (response.data && response.data.isBlocked) {
      currentRequest.isDnsBlock = response.data.isBlocked;
      currentRequest.blockedB64Flag =
        response.data.blockedB64Flag !== ""
          ? response.data.blockedB64Flag
          : currentRequest.blockedB64Flag;
      currentRequest.stopProcessing = true;
      currentRequest.dnsBlockResponse();
    } else {
      currentRequest.dnsResponse(this.parameter.get("responseBodyBuffer"));
      currentRequest.decodedDnsPacket = this.parameter.get(
        "responseDecodedDnsPacket"
      );
      currentRequest.stopProcessing = true;
    }
  }
}

function loadException(response, currentRequest) {
  log.e(JSON.stringify(response));
  currentRequest.stopProcessing = true;
  currentRequest.isException = true;
  currentRequest.exceptionStack = response.exceptionStack;
  currentRequest.exceptionFrom = response.exceptionFrom;
  currentRequest.dnsExceptionResponse();
}

/**
 * Retrieves parameters of a plugin
 * @param {String[]} list - Parameters of a plugin
 * @returns - Object of plugin parameters
 */
function generateParam(parameter, list) {
  const param = {};
  for (const key of list) {
    if (parameter.has(key)) {
      param[key] = parameter.get(key);
    }
  }
  return param;
}

async function setRequest(parameter, currentRequest) {
  const request = parameter.get("request");
  parameter.set("isDnsMsg", util.isDnsMsg(request));
  const isDnsMsg = parameter.get("isDnsMsg");

  if (!isValidRequest(isDnsMsg, request)) {
    setInvalidResponse(currentRequest);
    return;
  }

  if (!isDnsMsg) {
    return;
  }

  const buf = await getBodyBuffer(request);
  parameter.set("requestBodyBuffer", buf);
  parameter.set("requestDecodedDnsPacket", dnsutil.decode(buf));
  currentRequest.decodedDnsPacket = parameter.get("requestDecodedDnsPacket");
}

async function getBodyBuffer(request) {
  if (request.method.toUpperCase() === "GET") {
    const QueryString = new URL(request.url).searchParams;
    return base64ToArrayBuffer(
      decodeURI(QueryString.get("dns")).replace(/-/g, "+").replace(/_/g, "/")
    );
  } else {
    return await request.arrayBuffer();
  }
}

function setInvalidResponse(currentRequest) {
  currentRequest.httpResponse = new Response(null, {
    status: 400,
    statusText: "Bad Request",
  });
  currentRequest.stopProcessing = true;
}

function isValidRequest(isDnsMsg, req) {
  if (!isDnsMsg && req.method.toUpperCase() === "POST") return false;
  return true;
}

function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
