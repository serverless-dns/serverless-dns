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
import * as h2c from "httpx-server";
import { V1ProxyProtocol } from "proxy-protocol-js";
import * as system from "./system.js";
import { handleRequest } from "./core/doh.js";
import { stopAfter, uptime } from "./core/svc.js";
import * as bufutil from "./commons/bufutil.js";
import * as dnsutil from "./commons/dnsutil.js";
import * as envutil from "./commons/envutil.js";
import * as nodeutil from "./core/node/util.js";
import * as util from "./commons/util.js";
import "./core/node/config.js";

/**
 * @typedef {import("net").Socket} Socket
 * @typedef {import("tls").TLSSocket} TLSSocket
 * @typedef {import("http2").Http2ServerRequest} Http2ServerRequest
 * @typedef {import("http2").Http2ServerResponse} Http2ServerResponse
 */

let OUR_RG_DN_RE = null; // regular dns name match
let OUR_WC_DN_RE = null; // wildcard dns name match

let log = null;
let noreqs = -1;
let listeners = [];

((main) => {
  // listen for "go" and start the server
  system.sub("go", systemUp);
  // listen for "end" and stop the server
  system.sub("stop", systemDown);
  // ask prepare phase to commence
  system.pub("prepare");
})();

async function systemDown() {
  log.i(noreqs, "rcv stop signal; uptime", uptime() / 1000, "secs");

  const srvs = listeners;
  listeners = [];

  srvs.forEach((s) => {
    if (!s) return;
    const saddr = s.address();
    log.i("stopping...", saddr);
    // TODO: drain all sockets stackoverflow.com/a/14636625
    s.close(() => down(saddr));
  });

  // in some cases, node stops listening but the process doesn't exit because
  // of other unreleased resources (see: svc.js#systemStop). ideally, fly.io
  // health checks kick-in and apply a pre-defined restart policy, but as it
  // stands, health checks are unimplemented for machines, and so we wait for
  // a small amount of time, and force exit the process. the irony is, this
  // timed wait here will keep up the node process for longer than necessary.
  // in other cases where systemDown might be called due to interrupts such as
  // SIGINT, there's already a pre-defined timeout (10s or so) after which
  // fly.io init process should mop it up, regardless of what goes on in here.
  // FIXME rid of this delayed-exit once fly.io has health checks in place.
  // refs: community.fly.io/t/7341/6 and community.fly.io/t/7289
  util.timeout(/* 2s*/ 2 * 1000, () => {
    log.i("game over");
    // exit success aka 0; ref: community.fly.io/t/4547/6
    process.exit(0);
  });
}

function systemUp() {
  log = util.logger("NodeJs");
  if (!log) throw new Error("logger unavailable on system up");

  const onlydownload = envutil.blocklistDownloadOnly();
  const tlsoffload = envutil.isCleartext();

  if (onlydownload) {
    log.i("in download mode, not running the dns resolver");
    return;
  }

  if (tlsoffload) {
    // fly.io terminated tls?
    const portdoh = envutil.dohCleartextBackendPort();
    const portdot = envutil.dotCleartextBackendPort();

    // TODO: ProxyProtoV2 with TLS ClientHello (unsupported by Fly.io, rn)
    // DNS over TLS Cleartext
    const dotct = net
      // serveTCP must eventually call machines-heartbeat
      .createServer(serveTCP)
      .listen(portdot, () => up("DoT Cleartext", dotct.address()));

    // DNS over HTTPS Cleartext
    // Same port for http1.1/h2 does not work on node without tls, that is,
    // http2.createServer with opts { ALPNProtocols: ["h2", "http/1.1"],
    // allowHTTP1: true } doesn't handle http1.1 at all (but it does with
    // http2.createSecureServer which involves tls).
    // Ref (for servers): github.com/nodejs/node/issues/34296
    // Ref (for clients): github.com/nodejs/node/issues/31759
    // Impl: stackoverflow.com/a/42019773
    const dohct = h2c
      // serveHTTPS must eventually invoke machines-heartbeat
      .createServer(serveHTTPS)
      .listen(portdoh, () => up("DoH Cleartext", dohct.address()));

    listeners = [dotct, dohct];
  } else {
    // terminate tls ourselves
    const tlsOpts = {
      key: envutil.tlsKey(),
      cert: envutil.tlsCrt(),
    };
    const portdot1 = envutil.dotBackendPort();
    const portdot2 = envutil.dotProxyProtoBackendPort();
    const portdoh = envutil.dohBackendPort();

    // DNS over TLS
    const dot1 = tls
      // serveTLS must eventually invoke machines-heartbeat
      .createServer(tlsOpts, serveTLS)
      .listen(portdot1, () => up("DoT", dot1.address()));

    // DNS over TLS w ProxyProto
    const dot2 =
      envutil.isDotOverProxyProto() &&
      net
        // serveDoTProxyProto must evenually invoke machines-heartbeat
        .createServer(serveDoTProxyProto)
        .listen(portdot2, () => up("DoT ProxyProto", dot2.address()));

    // DNS over HTTPS
    const doh = http2
      // serverHTTPS must eventually invoke machines-heartbeat
      .createSecureServer({ ...tlsOpts, allowHTTP1: true }, serveHTTPS)
      .listen(portdoh, () => up("DoH", doh.address()));

    // may contain null elements
    listeners = [dot1, dot2, doh];
  }
  machinesHeartbeat();
}

function down(addr) {
  log.i(`closed: [${addr.address}]:${addr.port}`);
}

function up(server, addr) {
  log.i(server, `listening on: [${addr.address}]:${addr.port}`);
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

  const dotSock = net.connect(envutil.dotBackendPort(), () =>
    log.d("DoT socket ready")
  );

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
  const qlenBuf = bufutil.createBuffer(dnsutil.dnsHeaderSize);
  const qlenBufOffset = bufutil.recycleBuffer(qlenBuf);

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
  log.d(rgDnRE, wcDnRE);
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
  if (s.length > 3) {
    // ["1-flag", "max", "rethinkdns", "com"] => "max.rethinkdns.com"]
    const host = s.splice(1).join(".");
    // previously, "-" was replaced with "+" as doh handlers used "+" to
    // differentiate between a b32 flag and a b64 flag ("-" is a valid b64url
    // char; "+" is not); but not anymore. If ":" appears first, the flag
    // is treated as b64 or if "-" appears first, then as a b32 flag.
    const flag = s[0];

    log.d(`flag: ${flag}, host: ${host}`);
    return [flag, host];
  } else {
    // sni => max.rethinkdns.com
    log.d(`flag: "", host: ${host}`);
    return ["", sni];
  }
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

  machinesHeartbeat();
  log.d(`(${socket.getProtocol()}), tls reused? ${socket.isSessionReused()}`);

  const [flag, host] = isOurWcDn ? getMetadata(sni) : ["", sni];
  const sb = makeScratchBuffer();

  log.d("----> DoT request", host, flag);
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
 * Services a DNS over TCP connection
 * @param {Socket} socket
 */
function serveTCP(socket) {
  // TODO: TLS ClientHello is sent in proxy-proto v2, but fly.io
  // doesn't yet support v2, but only v1. ClientHello would contain
  // the SNI which we could then use here.
  const [flag, host] = ["", "ignored.example.com"];
  const sb = makeScratchBuffer();

  machinesHeartbeat();
  log.d("----> DoT Cleartext request", host, flag);

  socket.on("data", (data) => {
    handleTCPData(socket, data, sb, host, flag);
  });
  socket.on("end", () => {
    socket.end();
  });
  socket.on("error", (e) => {
    log.w("TCP socket error, closing connection");
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
    sb.qBuf = bufutil.createBuffer(qlen);
    sb.qBufOffset = bufutil.recycleBuffer(sb.qBuf);
  }

  sb.qBuf.fill(data, sb.qBufOffset);
  sb.qBufOffset += size;

  // exactly qlen bytes read till now, handle the dns query
  if (sb.qBufOffset === qlen) {
    handleTCPQuery(sb.qBuf, socket, host, flag);
    // reset qBuf and qlenBuf states
    sb.qlenBufOffset = bufutil.recycleBuffer(sb.qlenBuf);
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
    if (bufutil.emptyBuf(r)) {
      log.w("empty ans from resolve");
      ok = false;
    } else {
      const rlBuf = bufutil.encodeUint8ArrayBE(r.byteLength, 2);
      const chunk = new Uint8Array([...rlBuf, ...r]);

      // writing to a destroyed socket crashes nodejs
      if (!socket.destroyed) {
        socket.write(chunk);
      } else {
        ok = false;
        log.w("send fail, tcp socket destroyed");
      }
    }
  } catch (e) {
    ok = false;
    log.w("send fail, err", e);
  }
  log.endTime(t);

  // close socket when !ok
  if (!ok && !socket.destroyed) {
    close(socket);
  } // else: expect pipelined queries on the same socket
}

/**
 * @param {Buffer} q
 * @param {String} host
 * @param {String} flag
 * @return {Promise<Uint8Array>}
 */
async function resolveQuery(rxid, q, host, flag) {
  // Using POST, since GET requests cannot be greater than 2KB,
  // where-as DNS-over-TCP msgs could be upto 64KB in size.
  const freq = new Request(`https://${host}/${flag}`, {
    method: "POST",
    headers: util.concatHeaders(
      util.dnsHeaders(),
      util.contentLengthHeader(q),
      util.rxidHeader(rxid)
    ),
    body: q,
  });

  const r = await handleRequest(util.mkFetchEvent(freq));

  const ans = await r.arrayBuffer();

  if (!bufutil.emptyBuf(ans)) {
    return new Uint8Array(ans);
  } else {
    log.w(rxid, host, "empty ans, send servfail; flags?", flag);
    return dnsutil.servfailQ(q);
  }
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
  const b = bufutil.concatBuf(buffers);
  const bLen = b.byteLength;

  log.endTime(t);

  if (util.isPostRequest(req) && !dnsutil.validResponseSize(b)) {
    res.writeHead(dnsutil.dohStatusCode(b), util.corsHeadersIfNeeded(ua));
    res.end();
    log.w(`HTTP req body length out of bounds: ${bLen}`);
    return;
  }

  machinesHeartbeat();
  log.d("----> DoH request", req.method, bLen, req.url);
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

    // nb: req.url is a url-path, for ex: /a/b/c
    const fReq = new Request(new URL(req.url, `https://${host}`), {
      // Note: In VM container, Object spread may not be working for all
      // properties, especially of "hidden" Symbol values!? like "headers"?
      ...req,
      headers: util.concatHeaders(
        util.rxidHeader(rxid),
        nodeutil.copyNonPseudoHeaders(req.headers)
      ),
      method: req.method,
      body: req.method === "POST" ? b : null,
    });

    log.lapTime(t, "upstream-start");

    const fRes = await handleRequest(util.mkFetchEvent(fReq));

    log.lapTime(t, "upstream-end");

    res.writeHead(fRes.status, util.copyHeaders(fRes));

    log.lapTime(t, "send-head");

    // ans may be null on non-2xx responses, such as redirects (3xx) by cc.js
    // or 4xx responses on timeouts or 5xx on invalid http method
    const ans = await fRes.arrayBuffer();

    log.lapTime(t, "recv-ans");

    if (!bufutil.emptyBuf(ans)) {
      res.end(bufutil.bufferOf(ans));
    } else {
      // expect fRes.status to be set to non 2xx above
      res.end();
    }
  } catch (e) {
    res.writeHead(400); // bad request
    res.end();
    log.w(e);
  }

  log.endTime(t);
}

function machinesHeartbeat() {
  // increment no of requests
  noreqs += 1;
  if (noreqs % 100 === 0) {
    log.i(noreqs, "requests so far in", uptime() / 1000, "secs");
  }
  // nothing to do, if not on fly
  if (!envutil.onFly()) return;
  // if a fly machine app, figure out ttl
  const t = envutil.machinesTimeoutMillis();
  log.d("extend-machines-ttl by", t);
  if (t >= 0) stopAfter(t);
  // else: not on machines
}
