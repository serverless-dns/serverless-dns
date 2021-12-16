/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import net, { isIPv6, Socket } from "net";
import * as tls from "tls";
import * as http2 from "http2";
import { V1ProxyProtocol } from "proxy-protocol-js";

import { handleRequest } from "./index.js";
import * as log from "./helpers/log.js";
import { encodeUint8ArrayBE, sleep } from "./helpers/util.js";
import { TLS_CRT, TLS_KEY } from "./helpers/node/config.js";

// Ports which the services are exposed on. Corresponds to fly.toml ports.
const DOT_ENTRY_PORT = 10000;
const DOH_ENTRY_PORT = 8080;

const DOT_IS_PROXY_PROTO = eval(`process.env.DOT_HAS_PROXY_PROTO`);
const DOT_PROXY_PORT = DOT_ENTRY_PORT; // Unused if proxy proto is disabled

const DOT_PORT = DOT_IS_PROXY_PROTO
  ? DOT_ENTRY_PORT + 1 // Bump DOT port to allow entry via proxy proto port.
  : DOT_ENTRY_PORT;
const DOH_PORT = DOH_ENTRY_PORT;

const tlsOptions = {
  key: TLS_KEY,
  cert: TLS_CRT,
};

const minDNSPacketSize = 12 + 5;
const maxDNSPacketSize = 4096;

// A dns message over TCP stream has a header indicating length.
const dnsHeaderSize = 2;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

let OUR_RG_DN_RE = null; // regular dns name match
let OUR_WC_DN_RE = null; // wildcard dns name match

// main
((_) => {
  const dot1 = tls
    .createServer(tlsOptions, serveTLS)
    .listen(DOT_PORT, () => up("DoT", dot1.address()));

  const dot2 =
    DOT_IS_PROXY_PROTO &&
    net
      .createServer(serveDoTProxyProto)
      .listen(DOT_PROXY_PORT, () => up("DoT ProxyProto", dot2.address()));

  const doh = http2
    .createSecureServer({ ...tlsOptions, allowHTTP1: true }, serveHTTPS)
    .listen(DOH_PORT, () => up("DoH", doh.address()));

  function up(server, addr) {
    log.i(server, `listening on: [${addr.address}]:${addr.port}`);
  }
})();

function close(sock) {
  sock.destroy();
}

/**
 * Creates a duplex pipe between `a` and `b` sockets.
 * @param {Socket} a
 * @param {Socket} b
 * @returns - true if pipe created, false if error
 */
function proxySockets(a, b) {
  if (a.destroyed || b.destroyed) return false;
  a.pipe(b);
  b.pipe(a);
  return true;
}

/**
 * Proxies connection to DOT server, retrieving proxy proto header.
 * @param {net.Socket} clientSocket
 */
function serveDoTProxyProto(clientSocket) {
  let ppHandled = false;
  log.d("--> new client Connection");

  const dotSock = net.connect(DOT_PORT, () => {
    log.d("DoT socket ready");
  });

  dotSock.on("error", (e) => {
    log.w("DoT socket error, closing client connection", e);
    close(clientSocket);
    close(dotSock);
  });

  function handleProxyProto(buf) {
    // Data from only first tcp segment is to be consumed to get proxy proto.
    // After extracting proxy proto, a duplex pipe is created to DoT server.
    // So, further tcp segments return here.
    if (ppHandled) return;

    let chunk = buf.toString("ascii");
    let delim = chunk.indexOf("\r\n") + 2; // CRLF = \x0D \x0A
    ppHandled = true;

    if (delim < 0) {
      log.e("proxy proto header invalid / not found =>", chunk);
      close(clientSocket);
      close(dotSock);
      return;
    }

    try {
      // TODO: admission control
      const proto = V1ProxyProtocol.parse(chunk.slice(0, delim));
      log.d(`--> [${proto.source.ipAddress}]:${proto.source.port}`);

      // remaining data from first tcp segment
      let ok = !dotSock.destroyed && dotSock.write(buf.slice(delim));
      if (!ok)
        throw new Error(
          proto + " err dotSock write len(buf): " + buf.byteLength
        );

      ok = proxySockets(clientSocket, dotSock);
      if (!ok) throw new Error(proto + " err clientSock <> dotSock proxy");
    } catch (e) {
      log.w(e);
      close(clientSocket);
      close(dotSock);
      return;
    }
  }

  clientSocket.on("data", handleProxyProto);
  clientSocket.on("close", () => {
    close(dotSock);
  });
  clientSocket.on("error", (e) => {
    log.w("Client socket error, closing connection");
    close(clientSocket);
    close(dotSock);
  });
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
    qlenBuf: qlenBuf,
    qlenBufOffset: qlenBufOffset,
    qBuf: null,
    qBufOffset: 0,
  };
}

/**
 * Get RegEx's matching dns names of a CA certificate.
 * A non capturing RegEx is returned if no DNS names are found.
 * @param {tls.TLSSocket} socket - TLS socket to get CA certificate from.
 * @returns [RegEx, RegEx] - [regular, wildcard]
 */
function getDnRE(socket) {
  const SAN_DNS_PREFIX = "DNS:";
  const SAN = socket.getCertificate().subjectaltname;

  // Compute DNS RegExs from TLS SAN (subject-alt-names)
  // for max.rethinkdns.com SANs, see: https://crt.sh/?id=5708836299
  const RegExs = SAN.split(",").reduce(
    (arr, entry) => {
      entry = entry.trim();
      // Ignore non-DNS entries
      const u = entry.indexOf(SAN_DNS_PREFIX);
      if (u !== 0) return arr;
      // entry => DNS:*.max.rethinkdns.com
      // sliced => *.max.rethinkdns.com
      entry = entry.slice(SAN_DNS_PREFIX.length);

      // d => *\\.max\\.rethinkdns\\.com
      // wc => true
      // pos => 1
      // match => [a-z0-9-_]*\\.max\\.rethinkdns\\.com
      const d = entry.replace(/\./g, "\\.");
      const wc = d.startsWith("*");
      const pos = wc ? 1 : 0;
      const match = wc ? "[a-z0-9-_]" + d : d;

      arr[pos].push("(^" + match + "$)");

      return arr;
    },
    // [[Regular matches], [Wildcard matches]]
    [[], []]
  );

  const rgDnRE = new RegExp(RegExs[0].join("|"), "i");
  const wcDnRE = new RegExp(RegExs[1].join("|"), "i");
  log.i(rgDnRE, wcDnRE);
  return [rgDnRE, wcDnRE];
}

/**
 * Gets flag and hostname from TLS socket.
 * @param {tls.TLSSocket} socket - TLS socket to get SNI from.
 * @returns [flag, hostname]
 */
function getMetadataFromSni(socket) {
  if (!OUR_RG_DN_RE || !OUR_WC_DN_RE)
    [OUR_RG_DN_RE, OUR_WC_DN_RE] = getDnRE(socket);

  let flag = null;
  let host = null;

  const sni = socket.servername;
  if (!sni) {
    return [flag, host];
  }

  const isWc = OUR_WC_DN_RE.test(sni);
  const isReg = OUR_RG_DN_RE.test(sni);

  if (isWc) {
    // 1-flag.max.rethinkdns.com => ["1-flag", "max", "rethinkdns", "com"]
    let s = sni.split(".");
    // ["1-flag", "max", "rethinkdns", "com"] => "max.rethinkdns.com"]
    host = s.splice(1).join(".");
    // replace "-" with "+" as doh handlers use "+" to differentiate between
    // a b32 flag and a b64 flag ("-" is a valid b64url char; "+" is not)
    flag = s[0].replace(/-/g, "+");
  } else if (isReg) {
    // max.rethinkdns.com => max.rethinkdns.com
    host = sni;
    flag = "";
  } // nothing to extract

  return [flag, host];
}

/**
 * Services a DNS over TLS connection
 * @param {tls.TLSSocket} socket
 */
function serveTLS(socket) {
  const [flag, host] = getMetadataFromSni(socket);
  if (host === null) {
    close(socket);
    log.w("hostname not found, abort session");
    return;
  }

  const sb = makeScratchBuffer();

  socket.on("data", (data) => {
    handleTCPData(socket, data, sb, host, flag);
  });
  socket.on("end", () => {
    log.d("TLS socket clean half shutdown");
    socket.end();
  });
  socket.on("error", (e) => {
    log.w("TLS socket error, closing connection");
    close(socket);
  });
}

/**
 * Handle DNS over TCP/TLS data stream.
 * @param {Buffer} chunk - A TCP data segment
 */
function handleTCPData(socket, chunk, sb, host, flag) {
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
    log.w(`query range err: ql:${qlen} cl:${cl} rem:${rem}`);
    close(socket);
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
    log.w(`size mismatch: ${chunk.byteLength} <> ${qlen}`);
    close(socket);
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

  const t = log.starttime("handle-tcp-query");
  try {
    const r = await resolveQuery(q, host, flag);
    const rlBuf = encodeUint8ArrayBE(r.byteLength, 2);
    const chunk = new Uint8Array([...rlBuf, ...r]);

    // Don't write to a closed socket, else it will crash nodejs
    if (!socket.destroyed) ok = socket.write(chunk);
    if (!ok) log.e(`res write incomplete: < ${r.byteLength + 2}`);
  } catch (e) {
    ok = false;
    log.w(e);
  }
  log.endtime(t);

  // Only close socket on error, else it would break pipelining of queries.
  if (!ok && !socket.destroyed) {
    close(socket);
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
  const ua = req.headers["user-agent"];
  const buffers = [];

  const t = log.starttime("recv-https");

  for await (const chunk of req) {
    buffers.push(chunk);
  }
  const b = Buffer.concat(buffers);
  const bLen = b.byteLength;

  log.endtime(t);

  if (
    req.method == "POST" &&
    (bLen < minDNSPacketSize || bLen > maxDNSPacketSize)
  ) {
    res.writeHead(
      bLen > maxDNSPacketSize ? 413 : 400,
      ua && ua.startsWith("Mozilla/5.0") ? corsHeaders : {}
    );
    res.end();
    log.w(`HTTP req body length out of bounds: ${bLen}`);
    return;
  }

  log.d("-> HTTPS req", req.method, bLen);
  handleHTTPRequest(b, req, res);
}

/**
 * @param {Buffer} b - Request body
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 */
async function handleHTTPRequest(b, req, res) {
  const t = log.starttime("handle-http-req");
  try {
    let host = req.headers.host || req.headers[":authority"];
    if (isIPv6(host)) host = `[${host}]`;

    let reqHeaders = {};
    // Drop http/2 pseudo-headers
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

    log.laptime(t, "upstream-start");

    const fRes = await handleRequest({ request: fReq });

    log.laptime(t, "upstream-end");

    // Object.assign, Object spread, etc doesn't work with `node-fetch` Headers
    const resHeaders = {};
    fRes.headers.forEach((v, k) => {
      resHeaders[k] = v;
    });

    res.writeHead(fRes.status, resHeaders);

    log.laptime(t, "send-head");

    const ans = Buffer.from(await fRes.arrayBuffer());

    log.laptime(t, "recv-ans");

    res.end(ans);
  } catch (e) {
    res.end();
    log.w(e);
  }

  log.endtime(t);
}
