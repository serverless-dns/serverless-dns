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

(main => {
  system.sub("ready", systemReady)
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
    const blocklists = await import ("./node/blocklists.js");
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
    this.registerParameter("request", event.request);
    this.registerParameter("event", event);
    this.registerParameter("dnsQuestionBlock", services.dnsQuestionBlock);
    this.registerParameter("dnsResponseBlock", services.dnsResponseBlock);
    this.registerParameter("dnsCache", dnsCache);

    this.plugin = [];

    this.registerPlugin(
      "userOperation",
      services.userOperation,
      ["dnsResolverUrl", "request", "isDnsMsg"],
      userOperationCallBack,
      false,
    );

    this.registerPlugin(
      "AggressiveCaching",
      services.dnsCacheHandler,
      [
        "userBlocklistInfo",
        "request",
        "requestDecodedDnsPacket",
        "isDnsMsg",
        "dnsCache",
        "dnsQuestionBlock",
        "dnsResponseBlock",
      ],
      dnsAggCacheCallBack,
      false,
    );

    this.registerPlugin(
      "blocklistFilter",
      services.blocklistWrapper,
      [
        "blocklistUrl",
        "latestTimestamp",
        "workerTimeout",
        "tdParts",
        "tdNodecount",
        "fetchTimeout",
      ],
      blocklistFilterCallBack,
      false,
    );

    this.registerPlugin(
      "commandControl",
      services.commandControl,
      [
        "request",
        "blocklistFilter",
        "latestTimestamp",
        "isDnsMsg",
      ],
      commandControlCallBack,
      false,
    );
    this.registerPlugin(
      "dnsQuestionBlock",
      services.dnsQuestionBlock,
      [
        "requestDecodedDnsPacket",
        "blocklistFilter",
        "userBlocklistInfo",
        "event",
        "request",
        "dnsCache",
      ],
      dnsQuestionBlockCallBack,
      false,
    );
    this.registerPlugin(
      "dnsResolver",
      services.dnsResolver,
      [
        "requestBodyBuffer",
        "request",
        "dnsResolverUrl",
        "requestDecodedDnsPacket",
        "event",
        "blocklistFilter",
        "dnsCache",
      ],
      dnsResolverCallBack,
      false,
    );
    this.registerPlugin(
      "DNSResponseBlock",
      services.dnsResponseBlock,
      [
        "userBlocklistInfo",
        "blocklistFilter",
        "responseDecodedDnsPacket",
        "responseBodyBuffer",
        "event",
        "request",
        "dnsCache",
      ],
      dnsResponseBlockCallBack,
      false,
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
    continueOnStopProcess,
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
    const t = log.startTime("exec-plugin");
    for (const p of this.plugin) {
      if (req.stopProcessing && !p.continueOnStopProcess) {
        continue;
      }

      log.lapTime(t, p.name, "send-req");

      const res = await p.module.RethinkModule(
        generateParam(this.parameter, p.param),
      );

      log.lapTime(t, p.name, "got-res");

      if (p.callBack) {
        await p.callBack.call(this, res, req);
      }

      log.lapTime(t, p.name, "post-callback");
    }
    log.endTime(t);
  }
}

/**
 * Adds "blocklistFilter" to RethinkPlugin params
 * @param {*} response - Contains `data` which is `blocklistFilter`
 * @param {*} currentRequest
 */
function blocklistFilterCallBack(response, currentRequest) {
  log.d("In blocklistFilterCallBack");

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
async function commandControlCallBack(response, currentRequest) {
  log.d("In commandControlCallBack", JSON.stringify(response.data));

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
async function userOperationCallBack(response, currentRequest) {
  log.d("In userOperationCallBack", JSON.stringify(response.data));

  if (response.isException) {
    loadException(response, currentRequest);
  } else {
    this.registerParameter(
      "userBlocklistInfo",
      response.data.userBlocklistInfo,
    );
    this.registerParameter(
      "dnsResolverUrl",
      response.data.dnsResolverUrl,
    );
  }
}

function dnsAggCacheCallBack(response, currentRequest) {
  log.d("In dnsAggCacheCallBack", JSON.stringify(response.data));

  if (response.isException) {
    loadException(response, currentRequest);
  } else if (response.data && response.data.isBlocked) {
    currentRequest.isDnsBlock = response.data.isBlocked;
    currentRequest.blockedB64Flag = response.data.blockedB64Flag;
    currentRequest.stopProcessing = true;
    currentRequest.dnsBlockResponse();
  } else if (response.data && response.data.dnsBuffer) {
    this.registerParameter("responseDecodedDnsPacket", response.data.dnsPacket);
    currentRequest.dnsResponse(response.data.dnsBuffer);
    currentRequest.decodedDnsPacket = response.data.dnsPacket;
    currentRequest.stopProcessing = true;
  }
}

function dnsQuestionBlockCallBack(response, currentRequest) {
  log.d("In dnsQuestionBlockCallBack", JSON.stringify(response.data));

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
function dnsResolverCallBack(response, currentRequest) {
  log.d("In dnsResolverCallBack", JSON.stringify(response.data));

  if (response.isException) {
    loadException(response, currentRequest);
  } else {
    this.registerParameter("responseBodyBuffer", response.data.dnsBuffer);

    this.registerParameter("responseDecodedDnsPacket", response.data.dnsPacket);
  }
}

/**
 * Adds "dnsCnameBlockResponse" to RethinkPlugin params
 * @param {*} response -
 * @param {*} currentRequest
 */
function dnsResponseBlockCallBack(response, currentRequest) {
  log.d("In dnsResponseBlockCallBack", JSON.stringify(response.data));

  if (response.isException) {
    loadException(response, currentRequest);
  } else if (response.data && response.data.isBlocked) {
    currentRequest.isDnsBlock = response.data.isBlocked;
    currentRequest.blockedB64Flag = response.data.blockedB64Flag !== ""
      ? response.data.blockedB64Flag
      : currentRequest.blockedB64Flag;
    currentRequest.stopProcessing = true;
    currentRequest.dnsBlockResponse();
  } else {
    currentRequest.dnsResponse(this.parameter.get("responseBodyBuffer"));
    currentRequest.decodedDnsPacket = this.parameter.get(
      "responseDecodedDnsPacket",
    );
    currentRequest.stopProcessing = true;
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
  let request = parameter.get("request");
  parameter.set("isDnsMsg", util.isDnsMsg(request))
  const isDnsMsg = parameter.get("isDnsMsg");

  if (!isValidRequest(isDnsMsg, request)) {
    setInvalidResponse(currentRequest);
    return;
  }

  if (!isDnsMsg) {
    return;
  }

  let buf = await getBodyBuffer(request);
  parameter.set("requestBodyBuffer", buf);
  parameter.set("requestDecodedDnsPacket", dnsutil.decode(buf));
  currentRequest.decodedDnsPacket = parameter.get("requestDecodedDnsPacket");
}

async function getBodyBuffer(request) {
  if (request.method.toUpperCase() === "GET") {
    const QueryString = (new URL(request.url)).searchParams;
    return base64ToArrayBuffer(
      decodeURI(QueryString.get("dns")).replace(/-/g, "+").replace(/_/g, "/"),
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

