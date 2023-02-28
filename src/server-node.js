/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import net, { isIPv6 } from "net";
import tls, { Server } from "tls";
import http2 from "http2";
import * as h2c from "httpx-server";
import { V2ProxyProtocol } from "proxy-protocol-js";
import * as system from "./system.js";
import { handleRequest } from "./core/doh.js";
import { stopAfter, uptime } from "./core/svc.js";
import * as bufutil from "./commons/bufutil.js";
import * as dnsutil from "./commons/dnsutil.js";
import * as envutil from "./commons/envutil.js";
import * as nodeutil from "./core/node/util.js";
import * as util from "./commons/util.js";
import "./core/node/config.js";
import { finished } from "stream";
import { LfuCache } from "@serverless-dns/lfu-cache";

/**
 * @typedef {import("net").Socket} Socket
 * @typedef {import("tls").TLSSocket} TLSSocket
 * @typedef {import("http2").Http2ServerRequest} Http2ServerRequest
 * @typedef {import("http2").Http2ServerResponse} Http2ServerResponse
 */

let OUR_RG_DN_RE = null; // regular dns name match
let OUR_WC_DN_RE = null; // wildcard dns name match

let log = null;

// todo: as metrics
class Stats {
  constructor() {
    this.noreqs = -1;
    this.nofchecks = 0;
    this.fasttls = 0;
    this.totfasttls = 0;
    this.tlserr = 0;
  }

  str() {
    return (
      `noreqs=${this.noreqs} nofchecks=${this.nofchecks} ` +
      `fasttls=${this.fasttls}/${this.totfasttls} tlserr=${this.tlserr}`
    );
  }
}

const stats = new Stats();
const listeners = { connmap: [], servers: [] };
// see also: dns-transport.js:ioTimeout
const ioTimeoutMs = 50000; // 50 secs
// nodejs.org/api/net.html#netcreateserveroptions-connectionlistener
const serverOpts = {
  keepAlive: true,
  noDelay: true,
};
// nodejs.org/api/tls.html#tlscreateserveroptions-secureconnectionlistener
const tlsOpts = {
  handshakeTimeout: Math.max((ioTimeoutMs / 5) | 0, 7000), // ms
  // blog.cloudflare.com/tls-session-resumption-full-speed-and-secure
  sessionTimeout: 60 * 60 * 12, // 12 hrs
};
// nodejs.org/api/http2.html#http2createsecureserveroptions-onrequesthandler
const h2Opts = {
  allowHTTP1: true,
};

const tlsSessions = new LfuCache("tlsSessions", 10000);
((main) => {
  // listen for "go" and start the server
  system.sub("go", systemUp);
  // listen for "end" and stop the server
  system.sub("stop", systemDown);
  // ask prepare phase to commence
  system.pub("prepare");
})();

async function systemDown() {
  // system-down even may arrive even before the process has had the chance
  // to start, in which case globals like env and log may not be available
  console.warn("W rcv stop; uptime", uptime() / 60000, "mins", stats.str());

  const srvs = listeners.servers;
  const cmap = listeners.connmap;
  listeners.servers = [];
  listeners.connmap = [];

  console.warn("W", stats.str(), "; closing", cmap.length, "servers");
  // drain all sockets stackoverflow.com/a/14636625
  // TODO: handle proxy protocol sockets
  for (const m of cmap) {
    if (!m) continue;
    console.warn("W closing...", m.size, "connections");
    for (const sock of m.values()) {
      close(sock);
    }
  }

  for (const s of srvs) {
    if (!s) continue;
    const saddr = s.address();
    console.warn("W stopping...", saddr);
    s.close(() => down(saddr));
    s.unref();
  }

  // in some cases, node stops listening but the process doesn't exit because
  // of other unreleased resources (see: svc.js#systemStop); so exit
  console.warn("W game over");
  // exit success aka 0; ref: community.fly.io/t/4547/6
  process.exit(0);
}

function systemUp() {
  log = util.logger("NodeJs");
  if (!log) throw new Error("logger unavailable on system up");

  const downloadmode = envutil.blocklistDownloadOnly();
  const profilermode = envutil.profileDnsResolves();
  const tlsoffload = envutil.isCleartext();

  if (downloadmode) {
    log.i("in download mode, not running the dns resolver");
    return;
  } else if (profilermode) {
    const durationms = 60 * 1000;
    log.w("in profiler mode, run for", durationms, "and exit");
    stopAfter(durationms);
  }

  if (tlsoffload) {
    // fly.io terminated tls?
    const portdoh = envutil.dohCleartextBackendPort();
    const portdot = envutil.dotCleartextBackendPort();

    // TODO: ProxyProtoV2 with TLS ClientHello (unsupported by Fly.io, rn)
    // DNS over TLS Cleartext
    const dotct = net
      // serveTCP must eventually call machines-heartbeat
      .createServer(serverOpts, serveTCP)
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
      .createServer(serverOpts, serveHTTPS)
      .listen(portdoh, () => up("DoH Cleartext", dohct.address()));

    const conns = trapServerEvents(dohct, dotct);
    listeners.connmap = [conns];
    listeners.servers = [dotct, dohct];
  } else {
    // terminate tls ourselves
    const secOpts = {
      key: envutil.tlsKey(),
      cert: envutil.tlsCrt(),
      ticketKeys: util.tkt48(),
      ...tlsOpts,
      ...serverOpts,
    };
    const portdot1 = envutil.dotBackendPort();
    const portdot2 = envutil.dotProxyProtoBackendPort();
    const portdoh = envutil.dohBackendPort();

    // DNS over TLS
    const dot1 = tls
      // serveTLS must eventually invoke machines-heartbeat
      .createServer(secOpts, serveTLS)
      .listen(portdot1, () => up("DoT", dot1.address()));

    // DNS over TLS w ProxyProto
    const dot2 =
      envutil.isDotOverProxyProto() &&
      net
        // serveDoTProxyProto must evenually invoke machines-heartbeat
        .createServer(serverOpts, serveDoTProxyProto)
        .listen(portdot2, () => up("DoT ProxyProto", dot2.address()));

    // DNS over HTTPS
    const doh = http2
      // serveHTTPS must eventually invoke machines-heartbeat
      .createSecureServer({ ...secOpts, ...h2Opts }, serveHTTPS)
      .listen(portdoh, () => up("DoH", doh.address()));

    const conns1 = trapServerEvents(dot2);
    const conns2 = trapSecureServerEvents(dot1, doh);
    listeners.connmap = [conns1, conns2];
    // may contain null elements
    listeners.servers = [dot1, dot2, doh];
  }

  if (envutil.httpCheck()) {
    const portcheck = envutil.httpCheckPort();
    const hcheck = h2c
      .createServer(serve200)
      .listen(portcheck, () => up("http-check", hcheck.address()));
    listeners.connmap.push(trapServerEvents(hcheck));
    listeners.servers.push(hcheck);
  }

  machinesHeartbeat();
}

/**
 * @param  {... import("http2").Http2Server | net.Server} servers
 * @returns {boolean}
 */
function trapServerEvents(...servers) {
  const conntrack = new Map();
  servers &&
    servers.forEach((s) => {
      if (!s) return;
      s.on("connection", (/** @type {net.Socket} */ socket) => {
        // use the network five tuple instead?
        const id = util.uid("sct");
        conntrack.set(id, socket);
        socket.setTimeout(ioTimeoutMs, () => {
          log.d("tcp: incoming conn timed out; " + id);
          socket.end();
        });

        socket.on("error", (err) => {
          log.d("tcp: incoming conn closed with err; " + err.message);
          close(socket);
        });

        socket.on("close", (haderr) => {
          conntrack.delete(id);
        });

        socket.on("end", () => {
          // TODO: is this needed? this is the default anyway
          socket.end();
        });
      });

      s.on("error", (err) => {
        log.e("tcp: stop! server error; " + err.message, err);
        stopAfter(0);
      });
    });

  return conntrack;
}

/**
 * @param  {... import("http2").Http2SecureServer | Server} servers
 * @returns {boolean}
 */
function trapSecureServerEvents(...servers) {
  const conntrack = new Map();

  servers &&
    servers.forEach((s) => {
      if (!s) return;
      // github.com/grpc/grpc-node/blob/e6ea6f517epackages/grpc-js/src/server.ts#L392
      s.on("secureConnection", (socket) => {
        // use the network five tuple instead?
        const id = util.uid("stls");
        conntrack.set(id, socket);
        socket.setTimeout(ioTimeoutMs, () => {
          log.d("tls: incoming conn timed out; " + id);
          socket.end();
        });

        // must be handled by Http2SecureServer, github.com/nodejs/node/issues/35824
        socket.on("error", (err) => {
          log.e("tls: incoming conn", id, "closed;", err.message);
          close(socket);
        });

        socket.on("close", (haderr) => {
          conntrack.delete(id);
        });

        socket.on("end", () => {
          // TODO: is this needed? this is the default anyway
          socket.end();
        });
      });

      const rottm = setInterval(() => rotateTkt(s), 86400000); // 24 hours
      rotm.unref();

      s.on("newSession", (id, data, next) => {
        const hid = bufutil.hex(id);
        tlsSessions.put(hid, data);
        log.d("tls: new session; " + hid);
        next();
      });

      s.on("resumeSession", (id, next) => {
        const hid = bufutil.hex(id);
        const data = tlsSessions.get(hid) || null;
        if (data) log.d("tls: resume session; " + hid);
        if (data) stats.fasttls += 1;
        else stats.totfasttls += 1;
        next(/* err*/ null, data);
      });

      s.on("error", (err) => {
        log.e("tls: stop! server error; " + err.message, err);
        stopAfter(0);
      });

      s.on("close", () => clearInterval(rottm));

      s.on("tlsClientError", (err, /** @type {TLSSocket} */ tlsSocket) => {
        stats.tlserr += 1;
        log.d("tls: client err; " + err.message);
        close(tlsSocket);
      });
    });

  return conntrack;
}

/**
 * @param {tls.Server} s
 * @returns {void}
 */
function rotateTkt(s) {
  if (!s || !s.listening) return;
  s.setTicketKeys(util.tkt48());
}

function down(addr) {
  console.warn(`W closed: [${addr.address}]:${addr.port}`);
}

function up(server, addr) {
  log.i(server, `listening on: [${addr.address}]:${addr.port}`);
}

/**
 * RST and/or closes tcp socket.
 * @param {net.Socket | tls.TLSSocket} sock
 */
function close(sock) {
  sock &&
    util.safeBox(() => {
      if (sock.connecting) sock.resetAndDestroy();
      else sock.destroySoon();
      sock.unref();
    });
}

/**
 * @param {Http2ServerResponse} res
 */
function resClose(res) {
  if (res && !res.destroy) util.safeBox(() => res.destroy());
}

/**
 * @param {Http2ServerResponse} res
 * @returns {Boolean}
 */
function resOkay(res) {
  // determine if res is not destroyed, finished, and is writable
  return res.writable;
}

/**
 * @param {net.Socket} sock
 * @returns {Boolean}
 */
function tcpOkay(sock) {
  return sock.writable;
}

/**
 * Creates a duplex pipe between `a` and `b` sockets.
 * @param {Socket} a
 * @param {Socket} b
 * @return {Boolean} - true if pipe created, false if error
 */
function proxySockets(a, b) {
  if (a.destroyed || b.destroyed) return false;
  // handle errors? stackoverflow.com/a/61091744
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
    log.w("DoT socket err, close conn", e);
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
      const proto = V2ProxyProtocol.parse(chunk.slice(0, delim));
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

  clientSocket.on("error", (e) => {
    log.w("Client socket error, closing connection");
    close(clientSocket);
    close(dotSock);
  });
  clientSocket.on("data", handleProxyProto);
}

class ScratchBuffer {
  constructor() {
    /** @type {Buffer} */
    this.qlenBuf = bufutil.createBuffer(dnsutil.dnsHeaderSize);
    /** @type {Number} */
    this.qlenBufOffset = bufutil.recycleBuffer(this.qlenBuf);
    this.qBuf = null;
    this.qBufOffset = 0;
  }

  allocOnce(sz) {
    if (this.qBuf === null) {
      this.qBuf = bufutil.createBuffer(sz);
      this.qBufOffset = bufutil.recycleBuffer(this.qBuf);
    }
  }
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
  log.i("SNIs: ", rgDnRE, wcDnRE);
  return [rgDnRE, wcDnRE];
}

/**
 * Gets flag and hostname from the wildcard domain name.
 * @param {String} sni - Wildcard SNI
 * @return {Array<String>} [flag, hostname]
 */
function getMetadata(sni) {
  // 1-flag.max.rethinkdns.com => ["1-flag", "max", "rethinkdns", "com"]
  // 1-flag.somedomain.tld => ["1-flag", "somedomain", "tld"]
  const s = sni.split(".");
  if (s.length > 2) {
    // ["1-flag", "max", "rethinkdns", "com"] => "max.rethinkdns.com"
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
    log.d("No SNI, close conn");
    close(socket);
    return;
  }

  if (!OUR_RG_DN_RE || !OUR_WC_DN_RE) {
    [OUR_RG_DN_RE, OUR_WC_DN_RE] = getDnRE(socket);
  }

  const isOurRgDn = OUR_RG_DN_RE.test(sni);
  const isOurWcDn = OUR_WC_DN_RE.test(sni);

  if (!isOurWcDn && !isOurRgDn) {
    log.w("unexpected SNI, close conn", sni);
    close(socket);
    return;
  }

  machinesHeartbeat();
  if (false) {
    const tkt = bufutil.hex(socket.getTLSTicket());
    const sess = bufutil.hex(socket.getSession());
    const proto = socket.getProtocol();
    const reused = socket.isSessionReused();
    log.d(`(${proto}), reused? ${reused}; ticket: ${tkt}; sess: ${sess}`);
  }

  const [flag, host] = isOurWcDn ? getMetadata(sni) : ["", sni];
  const sb = new ScratchBuffer();

  log.d("----> DoT request", host, flag);
  socket.on("data", (data) => {
    handleTCPData(socket, data, sb, host, flag);
  });
}

/**
 * Services a DNS over TCP connection
 * @param {Socket} socket
 */
function serveTCP(socket) {
  // TODO: TLS ClientHello is sent with proxy-proto v2
  const [flag, host] = ["", "ignored.example.com"];
  const sb = new ScratchBuffer();

  machinesHeartbeat();
  log.d("----> DoT Cleartext request", host, flag);

  socket.on("data", (data) => {
    handleTCPData(socket, data, sb, host, flag);
  });
}

/**
 * Handle DNS over TCP/TLS data stream.
 * @param {Socket} socket
 * @param {Buffer} chunk - A TCP data segment
 * @param {ScratchBuffer} sb - Scratch buffer
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

  sb.allocOnce(qlen);

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
  if (bufutil.emptyBuf(q) || !tcpOkay(socket)) return;

  const rxid = util.xid();
  const t = log.startTime("handle-tcp-query-" + rxid);
  try {
    const r = await resolveQuery(rxid, q, host, flag);
    if (bufutil.emptyBuf(r)) {
      log.w(rxid, "empty ans from resolve");
      ok = false;
    } else {
      const rlBuf = bufutil.encodeUint8ArrayBE(r.byteLength, 2);
      const data = new Uint8Array([...rlBuf, ...r]);
      measuredWrite(rxid, socket, data);
    }
  } catch (e) {
    ok = false;
    log.w(rxid, "send fail, err", e);
  }
  log.endTime(t);

  // close socket when !ok
  if (!ok) {
    close(socket);
  } // else: expect pipelined queries on the same socket
}

/**
 * @param {string} rxid
 * @param {net.Socket} socket
 * @param {Uint8Array} data
 */
function measuredWrite(rxid, socket, data) {
  let ok = tcpOkay(socket);
  // writing to a destroyed socket crashes nodejs
  if (!ok) {
    log.w(rxid, "tcp: send fail, socket not writable", bufutil.len(data));
    close(socket);
    return;
  }
  // nodejs.org/en/docs/guides/backpressuring-in-streams
  // stackoverflow.com/a/18933853
  // when socket.write is backpressured, it returns false.
  // wait for the "drain" event before read/write more data.
  ok = socket.write(data);
  if (!ok) {
    socket.pause();
    socket.once("drain", () => {
      socket.resume();
    });
  }
}
/**
 * @param {String} rxid
 * @param {Buffer} q
 * @param {String} host
 * @param {String} flag
 * @return {Promise<Uint8Array?>}
 */
async function resolveQuery(rxid, q, host, flag) {
  // Using POST, since GET requests cannot be greater than 2KB,
  // where-as DNS-over-TCP msgs could be upto 64KB in size.
  const freq = new Request(`https://${host}/${flag}`, {
    method: "POST",
    // TODO: populate req ip in x-nile-client-ip header
    // TODO: add host header
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
    return bufutil.normalize8(ans);
  } else {
    log.w(rxid, host, "empty ans, send servfail; flags?", flag);
    return dnsutil.servfailQ(q);
  }
}

async function serve200(req, res) {
  log.d("-------------> Http-check req", req.method, req.url);
  stats.nofchecks += 1;
  res.writeHead(200);
  res.end();
}

/**
 * Services a DNS over HTTPS connection
 * @param {Http2ServerRequest} req
 * @param {Http2ServerResponse} res
 */
async function serveHTTPS(req, res) {
  trapRequestResponseEvents(req, res);
  const ua = req.headers["user-agent"];

  const buffers = [];

  const t = log.startTime("recv-https");

  // if using for await loop, then it must be wrapped in a
  // try-catch block: stackoverflow.com/questions/69169226
  // if not, errors from reading req escapes unhandled.
  // for example: req is being read from, but the underlying
  // socket has been the closed (resulting in err_premature_close)
  req.on("data", (chunk) => buffers.push(chunk));

  req.on("end", () => {
    const b = bufutil.concatBuf(buffers);
    const bLen = b.byteLength;

    log.endTime(t);

    if (util.isPostRequest(req) && !dnsutil.validResponseSize(b)) {
      res.writeHead(dnsutil.dohStatusCode(b), util.corsHeadersIfNeeded(ua));
      res.end();
      log.w(`HTTP req body length out of bounds: ${bLen}`);
    } else {
      machinesHeartbeat();
      log.d("----> DoH request", req.method, bLen, req.url);
      handleHTTPRequest(b, req, res);
    }
  });
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
      // TODO: populate req ip in x-nile-client-ip header
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

    if (!resOkay(res)) {
      throw new Error("res not writable 1");
    }

    res.writeHead(fRes.status, util.copyHeaders(fRes));

    log.lapTime(t, "send-head");

    // ans may be null on non-2xx responses, such as redirects (3xx) by cc.js
    // or 4xx responses on timeouts or 5xx on invalid http method
    const ans = await fRes.arrayBuffer();

    log.lapTime(t, "recv-ans");

    if (!resOkay(res)) {
      throw new Error("res not writable 2");
    } else if (!bufutil.emptyBuf(ans)) {
      res.end(bufutil.normalize8(ans));
    } else {
      // expect fRes.status to be set to non 2xx above
      res.end();
    }
  } catch (e) {
    const ok = resOkay(res);
    if (ok && !res.headersSent) res.writeHead(400); // bad request
    if (ok && !res.writableEnded) res.end();
    if (!ok) resClose(res);
    log.w(e);
  }

  log.endTime(t);
}

/**
 * @param {Http2ServerRequest} req
 * @param {Http2ServerResponse} res
 */
function trapRequestResponseEvents(req, res) {
  // duplex streams end/finish difference: stackoverflow.com/a/34310963
  finished(res, (e) => {
    if (e) {
      const reqstr = nodeutil.req2str(req);
      const resstr = nodeutil.res2str(res);
      log.w("h2: res fin w error", reqstr, resstr, e);
    }
  });
  finished(req, (e) => {
    if (e) {
      const reqstr = nodeutil.req2str(req);
      const resstr = nodeutil.res2str(res);
      log.w("h2: req fin w error", reqstr, resstr, e);
    }
  });
}

function machinesHeartbeat() {
  // increment no of requests
  stats.noreqs += 1;
  if (stats.noreqs % 100 === 0) {
    log.i(stats.str(), "in", uptime() / 60000, "mins");
  }
  // nothing to do, if not on fly
  if (!envutil.onFly()) return;
  // if a fly machine app, figure out ttl
  const t = envutil.machinesTimeoutMillis();
  log.d("extend-machines-ttl by", t);
  if (t >= 0) stopAfter(t);
  // else: not on machines
}
