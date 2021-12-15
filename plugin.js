/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
const debug = false;

import { BlocklistWrapper } from "@serverless-dns/blocklist-wrapper";
import { CommandControl } from "@serverless-dns/command-control";
import { UserOperation } from "@serverless-dns/basic";
import {
  DNSAggCache,
  DNSBlock,
  DNSResolver,
  DNSResponseBlock,
} from "@serverless-dns/dns-operation";

const blocklistWrapper = new BlocklistWrapper();
const commandControl = new CommandControl();
const userOperation = new UserOperation();
const dnsBlock = new DNSBlock();
const dnsResolver = new DNSResolver();
const dnsResponseBlock = new DNSResponseBlock();
const dnsAggCache = new DNSAggCache();

export default class RethinkPlugin {
  /**
   * @param {{request: Request}} event
   * @param {Env} env
   */
  constructor(event, env) {
    /**
     * Parameters of RethinkPlugin which may be used by individual plugins.
     */
    this.parameter = new Map(env.getEnvMap());
    this.registerParameter("request", event.request);
    this.registerParameter("event", event);
    this.registerParameter(
      "isDnsMsg",
      (event.request.headers.get("Accept") == "application/dns-message" ||
        event.request.headers.get("Content-Type") == "application/dns-message"),
    );

    this.plugin = [];

    this.registerPlugin(
      "userOperation",
      userOperation,
      ["dnsResolverUrl", "request", "isDnsMsg"],
      userOperationCallBack,
      false,
    );

    this.registerPlugin(
      "AggressiveCaching",
      dnsAggCache,
      [
        "userBlocklistInfo",
        "request",
        "requestBodyBuffer",
        "isAggCacheReq",
        "isDnsMsg",
      ],
      dnsAggCacheCallBack,
      false,
    );

    this.registerPlugin(
      "blocklistFilter",
      blocklistWrapper,
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
      commandControl,
      ["request", "blocklistFilter", "latestTimestamp"],
      commandControlCallBack,
      false,
    );
    this.registerPlugin(
      "dnsBlock",
      dnsBlock,
      [
        "requestDecodedDnsPacket",
        "blocklistFilter",
        "userBlocklistInfo",
        "isAggCacheReq",
        "event",
        "request",
      ],
      dnsBlockCallBack,
      false,
    );
    this.registerPlugin(
      "dnsResolver",
      dnsResolver,
      [
        "requestBodyBuffer",
        "request",
        "dnsResolverUrl",
        "runTimeEnv",
        "requestDecodedDnsPacket",
        "event",
        "blocklistFilter",
      ],
      dnsResolverCallBack,
      false,
    );
    this.registerPlugin(
      "DNSResponseBlock",
      dnsResponseBlock,
      ["userBlocklistInfo", "blocklistFilter", "responseDecodedDnsPacket"],
      dnsResponseBlockCallBack,
      false,
    );
  }

  registerParameter(key, parameter) {
    this.parameter.set(key, parameter);
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

  async executePlugin(currentRequest) {
    for (const singlePlugin of this.plugin) {
      if (
        currentRequest.stopProcessing && !singlePlugin.continueOnStopProcess
      ) {
        continue;
      }
      if (debug) console.log(singlePlugin.name);
      const response = await singlePlugin.module.RethinkModule(
        generateParam(this.parameter, singlePlugin.param),
      );

      if (singlePlugin.callBack) {
        await singlePlugin.callBack.call(this, response, currentRequest);
      }
    }
  }
}

/**
 * Adds "blocklistFilter" to RethinkPlugin params
 * @param {*} response - Contains `data` which is `blocklistFilter`
 * @param {*} currentRequest
 */
function blocklistFilterCallBack(response, currentRequest) {
  if (debug) {
    console.log("In blocklistFilterCallBack");
  }
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
  if (debug) {
    console.log("In commandControlCallBack");
    console.log(JSON.stringify(response.data));
  }

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
  if (debug) {
    console.log("In userOperationCallBack");
    console.log(JSON.stringify(response.data));
  }
  if (response.isException) {
    loadException(response, currentRequest);
  } else if (
    !this.parameter.get("isDnsMsg") &&
    this.parameter.get("request").method === "POST"
  ) {
    currentRequest.httpResponse = new Response(null, {
      status: 400,
      statusText: "Bad Request",
    });
    currentRequest.stopProcessing = true;
  } else {
    this.registerParameter(
      "requestBodyBuffer",
      await getBodyBuffer(
        this.parameter.get("request"),
        this.parameter.get("isDnsMsg"),
      ),
    );

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
  if (debug) {
    console.log("In dnsAggCacheCallBack");
    console.log(JSON.stringify(response.data));
  }
  if (response.isException) {
    loadException(response, currentRequest);
  } else if (response.data !== null) {
    this.registerParameter(
      "requestDecodedDnsPacket",
      response.data.reqDecodedDnsPacket,
    );
    currentRequest.decodedDnsPacket = response.data.reqDecodedDnsPacket;
    if (response.data.aggCacheResponse.type === "blocked") {
      currentRequest.isDnsBlock = response.data.aggCacheResponse.data.isBlocked;
      currentRequest.blockedB64Flag =
        response.data.aggCacheResponse.data.blockedB64Flag;
      currentRequest.stopProcessing = true;
      currentRequest.dnsBlockResponse();
    } else if (response.data.aggCacheResponse.type === "response") {
      this.registerParameter(
        "responseBodyBuffer",
        response.data.aggCacheResponse.data.bodyBuffer,
      );

      this.registerParameter(
        "responseDecodedDnsPacket",
        response.data.aggCacheResponse.data.decodedDnsPacket,
      );
      currentRequest.dnsResponse(
        response.data.aggCacheResponse.data.bodyBuffer,
      );
      currentRequest.decodedDnsPacket =
        response.data.aggCacheResponse.data.decodedDnsPacket;
      currentRequest.stopProcessing = true;
    }
  }
}

function dnsBlockCallBack(response, currentRequest) {
  if (debug) {
    console.log("In dnsBlockCallBack");
    console.log(JSON.stringify(response.data));
  }
  if (response.isException) {
    loadException(response, currentRequest);
  } else {
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
  if (debug) {
    console.log("In dnsResolverCallBack");
    console.log(JSON.stringify(response.data));
  }
  if (response.isException) {
    loadException(response, currentRequest);
  } else {
    this.registerParameter(
      "responseBodyBuffer",
      response.data.responseBodyBuffer,
    );

    this.registerParameter(
      "responseDecodedDnsPacket",
      response.data.responseDecodedDnsPacket,
    );
    currentRequest.decodedDnsPacket = response.data.responseDecodedDnsPacket;
  }
}

/**
 * Adds "dnsCnameBlockResponse" to RethinkPlugin params
 * @param {*} response -
 * @param {*} currentRequest
 */
function dnsResponseBlockCallBack(response, currentRequest) {
  if (debug) {
    console.log("In dnsCnameBlockCallBack");
    console.log(JSON.stringify(response.data));
  }
  if (response.isException) {
    loadException(response, currentRequest);
  } else {
    currentRequest.isDnsBlock = response.data.isBlocked;
    currentRequest.blockedB64Flag = response.data.blockedB64Flag;
    if (currentRequest.isDnsBlock) {
      currentRequest.stopProcessing = true;
      currentRequest.dnsBlockResponse();
    } else {
      currentRequest.dnsResponse(this.parameter.get("responseBodyBuffer"));
      currentRequest.stopProcessing = true;
    }
  }
}

function loadException(response, currentRequest) {
  console.error(JSON.stringify(response));
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
function generateParam(parameter,list) {
  const param = {};
  for (const key of list) {
    if (parameter.has(key)) {
      param[key] = parameter.get(key);
    }
  }
  return param;
}

async function getBodyBuffer(request, isDnsMsg) {
  if (!isDnsMsg) {
    return "";
  }
  if (request.method.toUpperCase() === "GET") {
    const QueryString = (new URL(request.url)).searchParams;
    return base64ToArrayBuffer(
      decodeURI(QueryString.get("dns")).replace(/-/g, "+").replace(/_/g, "/"),
    );
  } else {
    return await request.arrayBuffer();
  }
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
