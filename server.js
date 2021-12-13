/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { TLS_CRT, TLS_KEY } from "./helpers/node/config.js";
import net, { isIPv6 } from "net";
import * as proxyProtocolParser from "proxy-protocol-js";
import * as tls from "tls";
import * as http2 from "http2";
import { handleRequest } from "./index.js";
import { encodeUint8ArrayBE, sleep } from "./helpers/util.js";

const DOT_ENTRY_PORT = 10000;
const DOT_PROXY_PROTO_ENTRY_PORT = DOT_ENTRY_PORT + 1;
const DOH_ENTRY_PORT = 8080;

const DOT_IS_PROXY_PROTO = eval(`process.env.DOT_HAS_PROXY_PROTO`);
const DOT_PROXY_PORT = DOT_ENTRY_PORT;

const DOT_PORT = DOT_IS_PROXY_PROTO ? DOT_PROXY_PROTO_ENTRY_PORT : DOT_ENTRY_PORT;
const DOH_PORT = DOH_ENTRY_PORT;

const tlsOptions = {
  key: TLS_KEY,
  cert: TLS_CRT,
};

const minDNSPacketSize = 12 + 5;
const maxDNSPacketSize = 4096;
const dnsHeaderSize = 2;

let DNS_RG_RE = null; // regular dns name match
let DNS_WC_RE = null; // wildcard dns name match

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

const dot2 =
  DOT_IS_PROXY_PROTO &&
  net
    .createServer(serveDoTProxyProto)
    .listen(DOT_PROXY_PORT, () => up("DoT ProxyProto", dot2.address()));

const dot1 = tls
  .createServer(tlsOptions, serveTLS)
  .listen(DOT_PORT, () => up("DoT", dot1.address()));

const doh = http2
  .createSecureServer({ ...tlsOptions, allowHTTP1: true }, serveHTTPS)
  .listen(DOH_PORT, () => up("DoH", doh.address()));

function up(server, addr) {
  logi(server, `listening on: [${addr.address}]:${addr.port}`);
}

function loge() {
    const err = true;
    if (err) console.error(...arguments);
}

function logw() {
    const warn = true;
    if (warn) console.warn(...arguments);
}

function logi() {
    const info = true;
    if (info) console.info(...arguments);
}

function log() {
    const g = true;
    if (g) console.log(...arguments);
}

function logd() {
    const debug = false;
    if (debug) console.debug(...arguments);
}

function laptime(name) {
    const timer = false;
    if (timer) console.timeLog(name);
}

function starttime(name) {
    const timer = false;
    if (timer) console.time(name);
}

function endtime(name) {
    const timer = false;
    if (timer) console.timeEnd(name);
}

/**
 * Proxies connection to DOT server, retrieving proxy proto header if allowed
 * @param {net.Socket} inSocket
 */
function serveDoTProxyProto(inSocket) {
  // Alternatively, presence of proxy proto header in the first tcp segment
  // could be checked
  let hasProxyProto = DOT_IS_PROXY_PROTO;
  logd("\n--> new conn");

  const outSocket = net.connect(DOT_PORT, () => {
    logd("DoT tunnel ready");
  });

  function proxy(sin, sout) {
    if (sin.destroyed || sout.destroyed) return; // TODO: clean up sout/sin?
    sin.pipe(sout);
    sout.pipe(sin);
  }

  function handleProxyProto(buf) {
    if (!hasProxyProto) return;

    let chunk = buf.toString("ascii");
    let delim = chunk.indexOf("\r\n") + 2; // CRLF = \x0D \x0A
    hasProxyProto = false; // further tcp segments need not be checked

    if (delim < 0) {
      loge("proxy proto header invalid / not found =>", chunk);
      inSocket.destroy(); // TODO: close outsocket?
      return;
    }

    try {
      const proto = proxyProtocolParser.V1ProxyProtocol.parse(
        chunk.slice(0, delim)
      );
      logd(`--> [${proto.source.ipAddress}]:${proto.source.port}`);
    } catch (e) {
      logw("proxy proto header couldn't be parsed.", e);
      inSocket.destroy(); // TODO: close outsocket?
      return;
    }

    // remaining data from first tcp segment
    if (!outSocket.destroyed) {
      const ok = outSocket.write(buf.slice(delim));
      if (ok) proxy(inSocket, outSocket);
    } // TODO: else close inSocket?
  }

  inSocket.on("close", () => { // TODO: outsocket?
    inSocket.destroy();
  });

  inSocket.on("data", handleProxyProto);
}

function recycleBuffer(b) {
  b.fill(0);
  return 0;
}

function createBuffer(size) {
  return Buffer.allocUnsafe(size);
}

function makeScratchBuffer() {
  const qlenBuf = createBuffer(dnsHeaderSize);
  const qlenBufOffset = recycleBuffer(qlenBuf);

  return {
    "qlenBuf" : qlenBuf,
    "qlenBufOffset" : qlenBufOffset,
    "qBuf" : null,
    "qBufOffset" : 0
  };
}

function initCertRegexesIfNeeded(socket) {
  if (DNS_RG_RE || DNS_WC_RE) return;

  const TLS_SUBJECT_ALT = socket.getCertificate().subjectaltname;
  // compute subject-alt-names (SAN) regexes
  // for max.rethinkdns.com SANs, see: https://crt.sh/?id=5708836299
  const DNS_REGEXES = TLS_SUBJECT_ALT.split(",").reduce(
    (arr, entry) => {

      entry = entry.trim();
      if (!entry.startsWith("DNS:")) return arr;

      // entry => DNS:*max.rethinkdns.com
      // d => *\\.max\\.rethinkdns\\.com
      // wc => true
      // pos => 1
      // match => [a-z0-9-_]*\\.max\\.rethinkdns\\.com
      const d = entry
          .replace(/^DNS:/, "")
          .replace(/\./g, "\\.");
      const wc = d.startsWith("*");
      const pos = (wc) ? 1 : 0;
      const match = (wc) ? d.replace("*", "[a-z0-9-_]*") : d;

      arr[pos].push("(^" + match + "$)");

      return arr;
    }, [[], []]);

  DNS_RG_RE = new RegExp(DNS_REGEXES[0].join("|"), "i");
  DNS_WC_RE = new RegExp(DNS_REGEXES[1].join("|"), "i");
  logd(DNS_RG_RE, DNS_WC_RE);
}

function extractMetadataFromSni(socket) {
  initCertRegexesIfNeeded(socket);

  let flag = null;
  let host = null;

  const sni = socket.servername;
  if (!sni) {
    return [flag, host];
  }

  const isWc = DNS_WC_RE && DNS_WC_RE.test(sni);
  const isReg = DNS_RG_RE && DNS_RG_RE.test(sni);
  if (!isWc || !isReg) {
    return [flag, host];
  }

  // note: b32 flag uses delimiter `+` internally, instead of `-`.
  if (isWc) {
    // 1-flag.max.rethinkdns.com => ["1-flag", "max", "rethinkdns", "com"]
    let s = sni.split(".");
    // ["1-flag", "max", "rethinkdns", "com"] => "max.rethinkdns.com"]
    host = s.splice(1).join(".");
    // replace "-" with "+" as doh handlers use "+" to differentiate between
    // a b32 flag and a b64 flag ("-" is a valid b64url char; "+" is not)
    flag = s[0].replace(/-/g, "+");
  } else {
    // max.rethinkdns.com => max.rethinkdns.com
    host = sni;
    flag = "";
  }
  return [flag, host];
}

/**
 * Services a DNS over TLS connection
 * @param {tls.TLSSocket} socket
 */
function serveTLS(socket) {
  const [flag, host] = extractMetadataFromSni(socket)
  const sb = makeScratchBuffer();

  socket.on("data", (data) => {
    handleData(socket, data, sb, host, flag);
  });
  socket.on("end", () => {
    logd("TLS socket clean half shutdown");
    socket.end();
  });

}


/**
 * @param {Buffer} chunk - A TCP data segment
 */
function handleData(socket, chunk, sb, host, flag) {
  const cl = chunk.byteLength;
  if (cl <= 0) return;

  // read header first which contains length(dns-query)
  const rem = dnsHeaderSize - sb.qlenBufOffset;
  if (rem > 0) {
    const seek = Math.min(rem, cl);
    const read = chunk.slice(0, seek);
    sb.qlenBuf.fill(read, sb.qlenBufOffset);
    sb.qlenBufOffset += seek;
  }

  // header has not been read fully, yet
  if (sb.qlenBufOffset !== dnsHeaderSize) return;

  const qlen = sb.qlenBuf.readUInt16BE();
  if (qlen < minDNSPacketSize || qlen > maxDNSPacketSize) {
    logw(`query range err: ql:${qlen} cl:${cl} seek:${seek} rem:${rem}`);
    socket.destroy();
    return;
  }

  // rem bytes already read, is any more left in chunk?
  const size = cl - rem;
  if (size <= 0) return;

  // hopefully fast github.com/nodejs/node/issues/20130#issuecomment-382417255
  // chunk out dns-query starting rem-th byte
  const data = chunk.slice(rem);

  if (sb.qBuf === null) {
    sb.qBuf = createBuffer(qlen);
    sb.qBufOffset = recycleBuffer(sb.qBuf);
  }

  sb.qBuf.fill(data, sb.qBufOffset);
  sb.qBufOffset += size;

  // exactly qlen bytes read till now, handle the dns query
  if (sb.qBufOffset === qlen) {
    handleTCPQuery(sb.qBuf, socket, host, flag);
    // reset qBuf and qlenBuf states
    sb.qlenBufOffset = recycleBuffer(sb.qlenBuf);
    sb.qBuf = null;
    sb.qBufOffset = 0;
  } else if (sb.qBufOffset > qlen) {
    logw(`size mismatch: ${chunk.byteLength} <> ${qlen}`);
    socket.destroy();
    return;
  } // continue reading from socket
}

/**
 * @param {Buffer} q
 * @param {tls.TLSSocket} socket
 * @param {String} host
 * @param {String} flag
 */
async function handleTCPQuery(q, socket, host, flag) {
  let ok = true;
  if (socket.destroyed) return;

  starttime("handle-tcp-query");
  try {
    const r = await resolveQuery(q, host, flag);
    const rlBuf = encodeUint8ArrayBE(r.byteLength, 2);
    const chunk = new Uint8Array([...rlBuf, ...r]);

    // Don't write to a closed socket, else it will crash nodejs
    if (!socket.destroyed) ok = socket.write(chunk);
    if (!ok) loge(`res write incomplete: < ${r.byteLength + 2}`);
  } catch (e) {
    ok = false;
    logw(e);
  }
  endtime("handle-tcp-query");

  // Only close socket on error, else it would break pipelining of queries.
  if (!ok && !socket.destroyed) {
    socket.destroy();
  }
}

/**
 * @param {Buffer} q
 * @param {String} host
 * @param {String} flag
 * @returns
 */
async function resolveQuery(q, host, flag) {
  // Using POST, as GET requests are capped at 2KB, where-as DNS-over-TCP
  // has a much higher ceiling (even if rarely used)
  const r = await handleRequest({
    request: new Request(`https://${host}/${flag}`, {
      method: "POST",
      headers: {
        Accept: "application/dns-message",
        "Content-Type": "application/dns-message",
        "Content-Length": q.byteLength.toString(),
      },
      body: q,
    }),
  });

  return new Uint8Array(await r.arrayBuffer());
}

/**
 * Services a DNS over HTTPS connection
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 */
async function serveHTTPS(req, res) {
  const UA = req.headers["user-agent"];
  const buffers = [];
  for await (const chunk of req) {
    buffers.push(chunk);
  }
  const b = Buffer.concat(buffers);
  const bLen = b.byteLength;

  if (
    req.method == "POST" &&
    (bLen < minDNSPacketSize || bLen > maxDNSPacketSize)
  ) {
    logw(`HTTP req body length out of [min, max] bounds: ${bLen}`);
    res.writeHead(
      bLen > maxDNSPacketSize ? 413 : 400,
      UA && UA.startsWith("Mozilla/5.0") ? corsHeaders : {}
    );
    res.end();
    return;
  }

  logd("-> HTTPS req", req.method, bLen);
  handleHTTPRequest(b, req, res);
}

/**
 * @param {Buffer} b - Request body
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 */
async function handleHTTPRequest(b, req, res) {
  starttime("handle-http-req");
  try {
    let host = req.headers.host || req.headers[":authority"];
    if (isIPv6(host)) host = `[${host}]`;

    let reqHeaders = {};
    // remove http/2 pseudo-headers
    for (const key in req.headers) {
      if (key.startsWith(":")) continue;
      reqHeaders[key] = req.headers[key];
    }

    const fReq = new Request(new URL(req.url, `https://${host}`), {
      // Note: In VM container, Object spread may not be working for all
      // properties, especially of "hidden" Symbol values!? like "headers"?
      ...req,
      headers: reqHeaders,
      method: req.method,
      body: req.method == "POST" ? b : null,
    });

    const fRes = await handleRequest({ request: fReq });

    // Object.assign, Object spread, etc doesn't work with `node-fetch` Headers
    const resHeaders = {};
    fRes.headers.forEach((v, k) => {
      resHeaders[k] = v;
    });

    res.writeHead(fRes.status, resHeaders);
    res.end(Buffer.from(await fRes.arrayBuffer()));
  } catch (e) {
    logw(e);
  } finally {
    res.end();
  }
  endtime("handle-http-req");
}
