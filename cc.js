/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

export class CommandControl {
  constructor() {
    this.latestTimestamp = "";
  }

  /**
   * @param {Object} param
   * @param {Request} param.request
   * @param {*} param.blocklistFilter
   * @param {*} param.latestTimestamp
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
        param.request.headers
      );
    } else if (param.request.method === "POST") {
      let headers = param.request.headers;
      response.data.stopProcessing = true;
      const isPOSTDnsMsg =
        headers.get("Accept") == "application/dns-message" ||
        headers.get("Content-Type") == "application/dns-message";

      if (isPOSTDnsMsg) {
        response.data.stopProcessing = false;
      } else {
        response.data.httpResponse = new Response(null, {
          status: 400,
          statusText: "Bad Request",
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
          },
        });
      }
    }
    return response;
  }

  commandOperation(url, blocklistFilter, headers) {
    let response = {};
    response.isException = false;
    response.exceptionStack = "";
    response.exceptionFrom = "";
    response.data = {};
    const isGETDnsMsg = headers.get("Accept") == "application/dns-message";
    try {
      response.data.stopProcessing = true;
      response.data.httpResponse;
      const reqUrl = new URL(url);
      const queryString = reqUrl.searchParams;
      const pathSplit = reqUrl.pathname.split("/");
      let command = pathSplit[1];
      if (!command) {
        const d = reqUrl.host.split("."); // ex: xyz.max.rethinkdns.com
        command = (d.length > 3 && d[2] === "rethinkdns") ? d[0] : ""
      }
      const weburl = command == ""
        ? "https://rethinkdns.com/configure"
        : "https://rethinkdns.com/configure?s=added#" + command;
      if (command == "listtob64") {
        response.data.httpResponse = listToB64.call(
          this,
          queryString,
          blocklistFilter,
        );
      } else if (command == "b64tolist") {
        response.data.httpResponse = b64ToList.call(
          this,
          queryString,
          blocklistFilter,
        );
      } else if (command == "dntolist") {
        response.data.httpResponse = domainNameToList.call(
          this,
          queryString,
          blocklistFilter,
        );
      } else if (command == "dntouint") {
        response.data.httpResponse = domainNameToUint.call(
          this,
          queryString,
          blocklistFilter,
        );
      } else if (command == "config" || command == "configure") {
        let b64UserFlag = "";
        if (pathSplit.length >= 3) {
          b64UserFlag = pathSplit[2];
        }
        response.data.httpResponse = configRedirect.call(
          this,
          b64UserFlag,
          reqUrl.origin,
        );
      } else if (!isGETDnsMsg) {
        response.data.httpResponse = Response.redirect(weburl, 302);
      } else if (queryString.has("dns")) {
        response.data.stopProcessing = false;
      } else {
        response.data.httpResponse = new Response(null, {
          "status": 400,
          "statusText": "Bad Request",
          "headers": {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
          },
        });
      }
    } catch (e) {
      response.isException = true;
      response.exceptionStack = e.stack;
      response.exceptionFrom = "CommandControl commandOperation";
      response.data.httpResponse = new Response(
        JSON.stringify(response.exceptionStack),
      );
      response.data.httpResponse.headers.set(
        "Content-Type",
        "application/json",
      );
      response.data.httpResponse.headers.set(
        "Access-Control-Allow-Origin",
        "*",
      );
      response.data.httpResponse.headers.set(
        "Access-Control-Allow-Headers",
        "*",
      );
    }
    return response;
  }
}

function configRedirect(b64UserFlag, requestUrlOrigin) {
  let base = "https://rethinkdns.com/configure";
  let query = "?v=ext&u=" + requestUrlOrigin + "&tstamp=" +
    this.latestTimestamp + "#" + b64UserFlag;
  return Response.redirect(base + query, 302);
}

function domainNameToList(queryString, blocklistFilter) {
  let domainName = queryString.get("dn") || "";
  let returndata = {};
  returndata.domainName = domainName;
  returndata.version = this.latestTimestamp;
  returndata.list = {};
  var searchResult = blocklistFilter.hadDomainName(domainName);
  if (searchResult) {
    let list;
    let listDetail = {};
    for (let entry of searchResult) {
      list = blocklistFilter.getTag(entry[1]);
      listDetail = {};
      for (let listValue of list) {
        listDetail[listValue] = blocklistFilter.blocklistFileTag[listValue];
      }
      returndata.list[entry[0]] = listDetail;
    }
  } else {
    returndata.list = false;
  }

  let response = new Response(JSON.stringify(returndata));
  response.headers.set("Content-Type", "application/json");
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Headers", "*");
  return response;
}

function domainNameToUint(queryString, blocklistFilter) {
  let domainName = queryString.get("dn") || "";
  let returndata = {};
  returndata.domainName = domainName;
  returndata.list = {};
  var searchResult = blocklistFilter.hadDomainName(domainName);
  if (searchResult) {
    let list;
    let listDetail = {};
    for (let entry of searchResult) {
      returndata.list[entry[0]] = entry[1];
    }
  } else {
    returndata.list = false;
  }

  let response = new Response(JSON.stringify(returndata));
  response.headers.set("Content-Type", "application/json");
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Headers", "*");
  return response;
}

function listToB64(queryString, blocklistFilter) {
  let list = queryString.get("list") || [];
  let flagVersion = parseInt(queryString.get("flagversion")) || 0;
  let returndata = {};
  returndata.command = "List To B64String";
  returndata.inputList = list;
  returndata.flagVersion = flagVersion;
  returndata.b64String = blocklistFilter.getB64FlagFromTag(
    list.split(","),
    flagVersion,
  );
  let response = new Response(JSON.stringify(returndata));
  response.headers.set("Content-Type", "application/json");
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Headers", "*");
  return response;
}

function b64ToList(queryString, blocklistFilter) {
  let b64 = queryString.get("b64") || "";
  let returndata = {};
  returndata.command = "Base64 To List";
  returndata.inputB64 = b64;
  let response = blocklistFilter.unstamp(b64);
  if (response.userBlocklistFlagUint.length > 0) {
    returndata.list = blocklistFilter.getTag(response.userBlocklistFlagUint);
    returndata.listDetail = {};
    for (let listValue of returndata.list) {
      returndata.listDetail[listValue] =
        blocklistFilter.blocklistFileTag[listValue];
    }
  } else {
    returndata.list = "Invalid B64 String";
  }
  response = new Response(JSON.stringify(returndata));
  response.headers.set("Content-Type", "application/json");
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Headers", "*");
  return response;
}
