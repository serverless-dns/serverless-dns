/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as util from "../helpers/util.js";

export class CommandControl {
  constructor() {
    this.latestTimestamp = "";
  }

  /**
   * @param {Object} param
   * @param {Request} param.request
   * @param {*} param.blocklistFilter
   * @param {String | Number} param.latestTimestamp
   * @param {Boolean} param.isDnsMsg
   * @returns
   */
  async RethinkModule(param) {
    this.latestTimestamp = param.latestTimestamp;
    let response = {};
    response.isException = false;
    response.exceptionStack = "";
    response.exceptionFrom = "";
    response.data = {};
    response.data.stopProcessing = false;
    if (param.request.method === "GET") {
      response = this.commandOperation(
        param.request.url,
        param.blocklistFilter,
        param.isDnsMsg
      );
    } else if (param.request.method !== "POST") {
      // only GET and POST are supported
      response.data.httpResponse = new Response(null, {
        status: 405,
        statusText: "Method Not Allowed",
      });
    }
    return response;
  }

  isConfigureCmd(s) {
    return s === "configure" || s === "config";
  }

  isDohGetRequest(queryString) {
    return queryString && queryString.has("dns");
  }

  userFlag(url, isDnsCmd = false) {
    const emptyFlag = "";
    const p = url.pathname.split("/"); // ex: max.rethinkdns.com/cmd/XYZ
    const d = url.host.split("."); // ex: XYZ.max.rethinkdns.com

    // "configure" cmd, blockstamp (userFlag) must be at p[2]
    if (this.isConfigureCmd(p[1])) {
      return p.length >= 3 ? p[2] : emptyFlag;
    }

    // Redirect to the configure webpage when _no commands_ are set.
    // This happens when user clicks, say XYZ.max.rethinkdns.com or
    // max.rethinkdns.com/XYZ and it opens in a browser.

    // When incoming request is a dns-msg, all cmds are no-op
    if (isDnsCmd) return emptyFlag;

    // has path, possibly doh
    if (p[1]) return p[1]; // ex: max.rethinkdns.com/XYZ

    // no path, possibly dot
    return d.length > 1 ? d[0] : emptyFlag;
  }

  commandOperation(url, blocklistFilter, isDnsMsg) {
    const response = {
      isException: false,
      exceptionStack: "",
      exceptionFrom: "",
      data: {
        httpResponse: null,
        stopProcessing: true,
      },
    };

    try {
      const reqUrl = new URL(url);
      const queryString = reqUrl.searchParams;
      const pathSplit = reqUrl.pathname.split("/");

      const isDnsCmd = isDnsMsg || this.isDohGetRequest(queryString);

      if (isDnsCmd) {
        response.data.stopProcessing = false;
        return response;
      }

      const command = pathSplit[1];
      const b64UserFlag = this.userFlag(reqUrl, isDnsCmd);

      if (command === "listtob64") {
        response.data.httpResponse = listToB64(queryString, blocklistFilter);
      } else if (command === "b64tolist") {
        response.data.httpResponse = b64ToList(queryString, blocklistFilter);
      } else if (command === "dntolist") {
        response.data.httpResponse = domainNameToList(
          queryString,
          blocklistFilter,
          this.latestTimestamp
        );
      } else if (command === "dntouint") {
        response.data.httpResponse = domainNameToUint(
          queryString,
          blocklistFilter
        );
      } else if (command === "config" || command === "configure" || !isDnsCmd) {
        response.data.httpResponse = configRedirect(
          b64UserFlag,
          reqUrl.origin,
          this.latestTimestamp,
          !isDnsCmd
        );
      } else {
        response.data.httpResponse = new Response(null, {
          status: 400,
          statusText: "Bad Request",
        });
      }
    } catch (e) {
      response.isException = true;
      response.exceptionStack = e.stack;
      response.exceptionFrom = "CommandControl commandOperation";
      response.data.httpResponse = jsonResponse(response.exceptionStack);
    }
    return response;
  }
}

function isRethinkDns(hostname) {
  return (
    hostname.indexOf("rethinkdns") >= 0 || hostname.indexOf("bravedns") >= 0
  );
}

function configRedirect(userFlag, origin, timestamp, highlight) {
  const u = "https://rethinkdns.com/configure";
  let q = "?tstamp=" + timestamp;
  q += !isRethinkDns(origin) ? "&v=ext&u=" + origin : "";
  q += highlight ? "&s=added" : "";
  q += userFlag ? "#" + userFlag : "";
  return Response.redirect(u + q, 302);
}

function domainNameToList(queryString, blocklistFilter, latestTimestamp) {
  const domainName = queryString.get("dn") || "";
  const returndata = {};
  returndata.domainName = domainName;
  returndata.version = latestTimestamp;
  returndata.list = {};
  const searchResult = blocklistFilter.hadDomainName(domainName);
  if (searchResult) {
    let list;
    let listDetail = {};
    for (const entry of searchResult) {
      list = blocklistFilter.getTag(entry[1]);
      listDetail = {};
      for (const listValue of list) {
        listDetail[listValue] = blocklistFilter.blocklistFileTag[listValue];
      }
      returndata.list[entry[0]] = listDetail;
    }
  } else {
    returndata.list = false;
  }

  return jsonResponse(returndata);
}

function domainNameToUint(queryString, blocklistFilter) {
  const domainName = queryString.get("dn") || "";
  const returndata = {};
  returndata.domainName = domainName;
  returndata.list = {};
  const searchResult = blocklistFilter.hadDomainName(domainName);
  if (searchResult) {
    for (const entry of searchResult) {
      returndata.list[entry[0]] = entry[1];
    }
  } else {
    returndata.list = false;
  }

  return jsonResponse(returndata);
}

function listToB64(queryString, blocklistFilter) {
  const list = queryString.get("list") || [];
  const flagVersion = queryString.get("flagversion") || "0";
  const returndata = {};
  returndata.command = "List To B64String";
  returndata.inputList = list;
  returndata.flagVersion = flagVersion;
  returndata.b64String = blocklistFilter.getB64FlagFromTag(
    list.split(","),
    flagVersion
  );
  return jsonResponse(returndata);
}

function b64ToList(queryString, blocklistFilter) {
  const b64 = queryString.get("b64") || "";
  const returndata = {};
  returndata.command = "Base64 To List";
  returndata.inputB64 = b64;
  const response = blocklistFilter.unstamp(b64);
  if (response.userBlocklistFlagUint.length > 0) {
    returndata.list = blocklistFilter.getTag(response.userBlocklistFlagUint);
    returndata.listDetail = {};
    for (const listValue of returndata.list) {
      returndata.listDetail[listValue] =
        blocklistFilter.blocklistFileTag[listValue];
    }
  } else {
    returndata.list = "Invalid B64 String";
  }
  return jsonResponse(returndata);
}

function jsonResponse(obj) {
  return new Response(JSON.stringify(obj), { headers: util.jsonHeaders() });
}
