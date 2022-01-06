/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import net, { isIPv6 } from "net";
import tls from "tls";
import http2 from "http2";
import { V1ProxyProtocol } from "proxy-protocol-js";
import * as system from "./system.js";
import { handleRequest } from "./index.js";
import * as dnsutil from "./helpers/dnsutil.js";
import * as util from "./helpers/util.js";
import { copyNonPseudoHeaders } from "./helpers/node/util.js";
import "./helpers/node/config.js";

/**
 * @typedef {import("net").Socket} Socket
 * @typedef {import("tls").TLSSocket} TLSSocket
 * @typedef {import("http2").Http2ServerRequest} Http2ServerRequest
 * @typedef {import("http2").Http2ServerResponse} Http2ServerResponse
 */

// Ports which the services are exposed on. Corresponds to fly.toml ports.
const DOT_ENTRY_PORT = 10000;
const DOH_ENTRY_PORT = 8080;

const DOT_IS_PROXY_PROTO = eval(`process.env.DOT_HAS_PROXY_PROTO`);
const DOT_PROXY_PORT = DOT_ENTRY_PORT; // Unused if proxy proto is disabled

const DOT_PORT = DOT_IS_PROXY_PROTO
  ? DOT_ENTRY_PORT + 1 // Bump DOT port to allow entry via proxy proto port.
  : DOT_ENTRY_PORT;
const DOH_PORT = DOH_ENTRY_PORT;

let OUR_RG_DN_RE = null; // regular dns name match
let OUR_WC_DN_RE = null; // wildcard dns name match

let log = null;

((main) => {
  system.sub("go", systemUp);
})();

function systemUp() {
  const tlsOpts = {
    key: env.tlsKey,
    cert: env.tlsCrt,
  };

  log = util.logger("NodeJs");
  if (!log) throw new Error("logger unavailable on system up");

  const dot1 = tls
    .createServer(tlsOpts, serveTLS)
    .listen(DOT_PORT, () => up("DoT", dot1.address()));

  const dot2 =
    DOT_IS_PROXY_PROTO &&
    net
      .createServer(serveDoTProxyProto)
      .listen(DOT_PROXY_PORT, () => up("DoT ProxyProto", dot2.address()));

  const doh = http2
    .createSecureServer({ ...tlsOpts, allowHTTP1: true }, serveHTTPS)
    .listen(DOH_PORT, () => up("DoH", doh.address()));

  function up(server, addr) {
    log.i(server, `listening on: [${addr.address}]:${addr.port}`);
  }
}

function close(sock) {
  util.safeBox(() => sock.destroy());
}

/**
 * Creates a duplex pipe between `a` and `b` sockets.
 * @param {Socket} a
 * @param {Socket} b
 * @return {Boolean} - true if pipe created, false if error
 */
function proxySockets(a, b) {
  if (a.destroyed || b.destroyed) return false;
  a.pipe(b);
  b.pipe(a);
  return true;
}

/**
 * Proxies connection to DOT server, retrieving proxy proto header.
 * @param {Socket} clientSocket
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

    const chunk = buf.toString("ascii");
    const delim = chunk.indexOf("\r\n") + 2; // CRLF = \x0D \x0A
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
      if (!dotSock.destroyed) dotSock.write(buf.slice(delim));

      const ok = proxySockets(clientSocket, dotSock);
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

function makeScratchBuffer() {
  const qlenBuf = util.createBuffer(dnsutil.dnsHeaderSize);
  const qlenBufOffset = util.recycleBuffer(qlenBuf);

  return {
    qlenBuf: qlenBuf,
    qlenBufOffset: qlenBufOffset,
    qBuf: null,
    qBufOffset: 0,
  };
}

/**
 * Get RegEx's to match dns names of a CA certificate.
 * A non matching RegEx is returned if no DNS names are found.
 * @param {TLSSocket} socket - TLS socket to get CA certificate from.
 * @return {Array<[String]>} [regular RegExs, wildcard RegExs]
 */
function getDnRE(socket) {
  const SAN_DNS_PREFIX = "DNS:";
  const SAN = socket.getCertificate().subjectaltname;

  // Compute DNS RegExs from TLS SAN (subject-alt-names)
  // for max.rethinkdns.com SANs, see: https://crt.sh/?id=5708836299
  const regExs = SAN.split(",").reduce(
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

  const rgDnRE = new RegExp(regExs[0].join("|") || "(?!)", "i");
  const wcDnRE = new RegExp(regExs[1].join("|") || "(?!)", "i");
  log.i(rgDnRE, wcDnRE);
  return [rgDnRE, wcDnRE];
}

/**
 * Gets flag and hostname from the wildcard domain name.
 * @param {String} sni - Wildcard SNI
 * @return {Array<String>} [flag, hostname]
 */
function getMetadata(sni) {
  // 1-flag.max.rethinkdns.com => ["1-flag", "max", "rethinkdns", "com"]
  const s = sni.split(".");
  // ["1-flag", "max", "rethinkdns", "com"] => "max.rethinkdns.com"]
  const host = s.splice(1).join(".");
  // replace "-" with "+" as doh handlers use "+" to differentiate between
  // a b32 flag and a b64 flag ("-" is a valid b64url char; "+" is not)
  const flag = s[0].replace(/-/g, "+");

  log.d(`flag: ${flag}, host: ${host}`);
  return [flag, host];
}

/**
 * Services a DNS over TLS connection
 * @param {TLSSocket} socket
 */
function serveTLS(socket) {
  const sni = socket.servername;
  if (!sni) {
    log.d("No SNI, closing client connection");
    close(socket);
    return;
  }

  if (!OUR_RG_DN_RE || !OUR_WC_DN_RE) {
    [OUR_RG_DN_RE, OUR_WC_DN_RE] = getDnRE(socket);
  }

  const isOurRgDn = OUR_RG_DN_RE.test(sni);
  const isOurWcDn = OUR_WC_DN_RE.test(sni);

  if (!isOurWcDn && !isOurRgDn) {
    log.w("Not our DNS name, closing client connection");
    close(socket);
    return;
  }

  log.d(`(${socket.getProtocol()}), tls reused? ${socket.isSessionReused()}}`);

  const [flag, host] = isOurWcDn ? getMetadata(sni) : ["", sni];
  const sb = makeScratchBuffer();

  socket.on("data", (data) => {
    handleTCPData(socket, data, sb, host, flag);
  });
  socket.on("end", () => {
    socket.end();
  });
  socket.on("error", (e) => {
    log.w("TLS socket error, closing connection");
    close(socket);
  });
}

/**
 * Handle DNS over TCP/TLS data stream.
 * @param {TLSSocket} socket
 * @param {Buffer} chunk - A TCP data segment
 * @param {Object} sb - Scratch buffer
 * @param {String} host - Hostname
 * @param {String} flag - Blocklist Flag
 */
function handleTCPData(socket, chunk, sb, host, flag) {
  const cl = chunk.byteLength;
  if (cl <= 0) return;

  // read header first which contains length(dns-query)
  const rem = dnsutil.dnsHeaderSize - sb.qlenBufOffset;
  if (rem > 0) {
    const seek = Math.min(rem, cl);
    const read = chunk.slice(0, seek);
    sb.qlenBuf.fill(read, sb.qlenBufOffset);
    sb.qlenBufOffset += seek;
  }

  // header has not been read fully, yet
  if (sb.qlenBufOffset !== dnsutil.dnsHeaderSize) return;

  const qlen = sb.qlenBuf.readUInt16BE();
  if (!dnsutil.validateSize(qlen)) {
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
    sb.qBuf = util.createBuffer(qlen);
    sb.qBufOffset = util.recycleBuffer(sb.qBuf);
  }

  sb.qBuf.fill(data, sb.qBufOffset);
  sb.qBufOffset += size;

  // exactly qlen bytes read till now, handle the dns query
  if (sb.qBufOffset === qlen) {
    handleTCPQuery(sb.qBuf, socket, host, flag);
    // reset qBuf and qlenBuf states
    sb.qlenBufOffset = util.recycleBuffer(sb.qlenBuf);
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
 * @param {TLSSocket} socket
 * @param {String} host
 * @param {String} flag
 */
async function handleTCPQuery(q, socket, host, flag) {
  let ok = true;
  if (socket.destroyed) return;

  const rxid = util.xid();
  const t = log.startTime("handle-tcp-query-" + rxid);
  try {
    const r = await resolveQuery(rxid, q, host, flag);
    const rlBuf = util.encodeUint8ArrayBE(r.byteLength, 2);
    const chunk = new Uint8Array([...rlBuf, ...r]);

    // writing to a destroyed socket crashes nodejs
    if (!socket.destroyed) socket.write(chunk);
  } catch (e) {
    ok = false;
    log.w(e);
  }
  log.endTime(t);

  // Only close socket on error, else it would break pipelining of queries.
  if (!ok && !socket.destroyed) {
    close(socket);
  }
}

/**
 * @param {Buffer} q
 * @param {String} host
 * @param {String} flag
 * @return {Promise<Uint8Array>}
 */
async function resolveQuery(rxid, q, host, flag) {
  // Using POST, as GET requests are capped at 2KB, where-as DNS-over-TCP
  // has a much higher ceiling (even if rarely used)
  const r = await handleRequest({
    request: new Request(`https://${host}/${flag}`, {
      method: "POST",
      headers: util.concatHeaders(
        util.dnsHeaders(),
        util.contentLengthHeader(q),
        util.rxidHeader(rxid)
      ),
      body: q,
    }),
  });

  return new Uint8Array(await r.arrayBuffer());
}

/**
 * Services a DNS over HTTPS connection
 * @param {Http2ServerRequest} req
 * @param {Http2ServerResponse} res
 */
async function serveHTTPS(req, res) {
  const ua = req.headers["user-agent"];
  const buffers = [];

  const t = log.startTime("recv-https");

  for await (const chunk of req) {
    buffers.push(chunk);
  }
  const b = Buffer.concat(buffers);
  const bLen = b.byteLength;

  log.endTime(t);

  if (util.isPostRequest(req) && !dnsutil.validResponseSize(b)) {
    res.writeHead(dnsutil.dohStatusCode(b), util.corsHeadersIfNeeded(ua));
    res.end();
    log.w(`HTTP req body length out of bounds: ${bLen}`);
    return;
  }

  log.d("-> HTTPS req", req.method, bLen);
  handleHTTPRequest(b, req, res);
}

/**
 * @param {Buffer} b - Request body
 * @param {Http2ServerRequest} req
 * @param {Http2ServerResponse} res
 */
async function handleHTTPRequest(b, req, res) {
  const rxid = util.xid();
  const t = log.startTime("handle-http-req-" + rxid);
  try {
    let host = req.headers.host || req.headers[":authority"];
    if (isIPv6(host)) host = `[${host}]`;

    const fReq = new Request(new URL(req.url, `https://${host}`), {
      // Note: In VM container, Object spread may not be working for all
      // properties, especially of "hidden" Symbol values!? like "headers"?
      ...req,
      headers: util.concatHeaders(
        util.rxidHeader(rxid),
        copyNonPseudoHeaders(req.headers)
      ),
      method: req.method,
      body: req.method === "POST" ? b : null,
    });

    log.lapTime(t, "upstream-start");

    const fRes = await handleRequest({ request: fReq });

    log.lapTime(t, "upstream-end");

    res.writeHead(fRes.status, util.copyHeaders(fRes));

    log.lapTime(t, "send-head");

    const ans = Buffer.from(await fRes.arrayBuffer());

    log.lapTime(t, "recv-ans");

    res.end(ans);
  } catch (e) {
    res.end();
    log.w(e);
  }

  log.endTime(t);
}
