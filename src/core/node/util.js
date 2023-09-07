/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { Http2ServerRequest, Http2ServerResponse } from "node:http2";

/**
 * @param {String} TLS_CRT_KEY - Contains base64 (no wrap) encoded key and
 * certificate files seprated by a newline (\n) and described by `KEY=` and
 * `CRT=` respectively. Ex: `TLS_="KEY=encoded_string\nCRT=encoded_string"`
 * @return {Array<Buffer>} [TLS_KEY, TLS_CRT]
 */
export function getCertKeyFromEnv(TLS_CRT_KEY) {
  if (TLS_CRT_KEY == null) throw new Error("TLS cert / key not found");

  TLS_CRT_KEY = TLS_CRT_KEY.replace(/\\n/g, "\n");

  if (TLS_CRT_KEY.split("=", 1)[0].indexOf("KEY") >= 0) {
    return TLS_CRT_KEY.split("\n").map((v) =>
      Buffer.from(v.substring(v.indexOf("=") + 1), "base64")
    );
  } else if (TLS_CRT_KEY.split("\n")[1].split("=", 1)[0].indexOf("KEY") >= 0) {
    return TLS_CRT_KEY.split("\n")
      .reverse()
      .map((v) => Buffer.from(v.substring(v.indexOf("=") + 1), "base64"));
  } else {
    throw new Error("TLS cert / key malformed");
  }
}

/**
 * @param {Object} headers
 * @return {Object}
 */
export function copyNonPseudoHeaders(headers) {
  // nodejs req headers may be of form
  // ':authority': 'localhost:8080'
  // ':method': 'GET'
  // ':path': '/1:AAIAgA==?dns=AAABAAABAAAAAAAACnJldGhpbmtkbnMDY29tAAABAAE'
  // ':scheme': 'https'
  // accept: 'application/dns-message'
  // 'user-agent': 'Go-http-client/2.0'
  // [Symbol(nodejs.http2.sensitiveHeaders)]: []

  const out = {};

  if (!headers) return out;

  // drop http/2 pseudo-headers
  for (const name in headers) {
    if (name.startsWith(":")) continue;
    out[name] = headers[name];
  }

  return out;
}

/**
 * @param {Object} headers
 * @return {Object}
 */
export function transformPseudoHeaders(headers) {
  const out = {};

  if (!headers) return out;

  // transform http/2 pseudo-headers
  for (const name in headers) {
    if (name.startsWith(":")) {
      out[name.slice(1)] = headers[name];
    } else {
      out[name] = headers[name];
    }
  }

  return out;
}

/**
 * @param {Http2ServerRequest} req
 * @return {String}
 */
export function req2str(req) {
  if (!req) return "request[null]";
  return (
    `request[${req.method}] ${req.headers["content-type"]} ` +
    `${req.url} from ${req.headers["user-agent"]} ` +
    `${req.headers["content-length"]}/${req.readableLength} `
  );
}

/**
 * @param {Http2ServerResponse} res
 * @returns {String}
 */
export function res2str(res) {
  if (!res) return "response[null]";
  return (
    `response[${res.statusCode}] ${res.getHeader("content-type")} ` +
    `headers-sent? ${res.headersSent} write-ended? ${res.writableEnded} ` +
    `${res.getHeader("content-length")}/${res.writableLength}`
  );
}
