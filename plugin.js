/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { CommandControl } from "@serverless-dns/command-control";
import { UserOperation } from "@serverless-dns/basic";
import {
  DNSBlock,
  DNSResolver,
  DNSResponseBlock,
} from "@serverless-dns/dns-operation";

const commandControl = new CommandControl();
const userOperation = new UserOperation();
const dnsBlock = new DNSBlock();
const dnsResolver = new DNSResolver();
const dnsResponseBlock = new DNSResponseBlock();

export default class RethinkPlugin {
  /**
   * @param {BlocklistWrapper} blocklistFilter
   * @param {{request: Request}} event
   * @param {Env} env
   */
  constructor(blocklistFilter, event, env) {
    /**
     * Parameters of RethinkPlugin which may be used by individual plugins.
     */
    this.parameter = new Map(env.getEnvMap());
    this.registerParameter("blocklistFilter", blocklistFilter);
    this.registerParameter("request", event.request);
    this.registerParameter("event", event);
    this.plugin = [];
    this.registerPlugin(
      "commandControl",
      commandControl,
      ["request", "blocklistFilter", "latestTimestamp"],
      commandControlCallBack,
      false,
    );
    this.registerPlugin(
      "userOperation",
      userOperation,
      ["blocklistFilter", "dnsResolverUrl", "request"],
      userOperationCallBack,
      false,
    );
    this.registerPlugin(
      "dnsBlock",
      dnsBlock,
      ["requestBodyBuffer", "blocklistFilter", "userBlocklistInfo"],
      dnsBlockCallBack,
      false,
    );
    this.registerPlugin(
      "dnsResolver",
      dnsResolver,
      ["requestBodyBuffer", "request", "dnsResolverUrl", "runTimeEnv", "requestDecodedDnsPacket"],
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

      const response = await singlePlugin.module.RethinkModule(
        generateParam.call(this, singlePlugin.param),
      );

      if (singlePlugin.callBack) {
        await singlePlugin.callBack.call(this, response, currentRequest);
      }
    }
  }
}

/**
 * Adds "requestBodyBuffer" (arrayBuffer of "request" param) to RethinkPlugin
 * params
 * @param {*} response
 * @param {*} currentRequest
 */
async function commandControlCallBack(response, currentRequest) {
  // console.log("In userOperationCallBack")
  //console.log(JSON.stringify(response.data))
  if (response.data.stopProcessing) {
    currentRequest.httpResponse = response.data.httpResponse;
    currentRequest.stopProcessing = true;
  } else {
    const request = this.parameter.get("request");
    let bodyBuffer;
    if (request.method.toUpperCase() === "GET") {
      const QueryString = (new URL(request.url)).searchParams;
      bodyBuffer = base64ToArrayBuffer(
        decodeURI(QueryString.get("dns")).replace(/-/g, "+").replace(/_/g, "/"),
      );
    } else {
      bodyBuffer = await request.arrayBuffer();
    }
    this.registerParameter("requestBodyBuffer", bodyBuffer);
  }
}

/**
 * Adds "userBlocklistInfo" and "dnsResolverUrl" to RethinkPlugin params
 * @param {*} response - Contains `data` which is `userBlocklistInfo`
 * @param {*} currentRequest
 */
function userOperationCallBack(response, currentRequest) {
  //console.log("In userOperationCallBack")  
  if (response.isException) {
    //console.log(JSON.stringify(response))
    loadException(response, currentRequest);
  } else {
    this.registerParameter("userBlocklistInfo", response.data);
    this.registerParameter("dnsResolverUrl", response.data.dnsResolverUrl);
  }
}

function dnsBlockCallBack(response, currentRequest) {
  //console.log("In dnsBlockCallBack")  
  if (response.isException) {
    //console.log(JSON.stringify(response))
    loadException(response, currentRequest);
  } else {
    this.registerParameter("dnsBlockResponse", response.data);
    this.registerParameter("requestDecodedDnsPacket", response.data.decodedDnsPacket);
    currentRequest.isDnsBlock = response.data.isBlocked;
    currentRequest.isDomainInBlockListNotBlocked =
      response.data.isNotBlockedExistInBlocklist;
    currentRequest.decodedDnsPacket = response.data.decodedDnsPacket;
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
  //console.log("In dnsResolverCallBack")  
  if (response.isException) {
    //console.log(JSON.stringify(response))
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
  //console.log("In dnsCnameBlockCallBack")  
  if (response.isException) {
    //console.log(JSON.stringify(response))
    loadException(response, currentRequest);
  } else {
    this.registerParameter("dnsCnameBlockResponse", response.data);
    currentRequest.isDnsBlock = response.data.isBlocked;
    currentRequest.isDomainInBlockListNotBlocked =
      response.data.isNotBlockedExistInBlocklist;
    currentRequest.blockedB64Flag = response.data.blockedB64Flag;
    if (currentRequest.isDnsBlock) {
      currentRequest.stopProcessing = true;
      currentRequest.dnsBlockResponse();
    } else {
      currentRequest.dnsResponse(this.parameter.get("responseBodyBuffer"));
    }
  }
}

function loadException(response, currentRequest) {
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
function generateParam(list) {
  const param = {};
  for (const key of list) {
    if (this.parameter.has(key)) {
      param[key] = this.parameter.get(key);
    }
  }
  //console.log(param)
  return param;
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
