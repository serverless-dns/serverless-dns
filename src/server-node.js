/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// should always be the first import
// import whyIsNodeRunning from "why-is-node-running";
import "./core/node/config.js";

import { LfuCache } from "@serverless-dns/lfu-cache";
import * as h2c from "httpx-server";
import { X509Certificate } from "node:crypto";
import http2 from "node:http2";
import https from "node:https";
import net, { isIPv6 } from "node:net";
import { finished } from "node:stream";
import tls, { TLSSocket } from "node:tls";
import v8 from "node:v8";
import os from "os";
import process from "process";
import { V2ProxyProtocol } from "proxy-protocol-js";
import * as bufutil from "./commons/bufutil.js";
import * as nodecrypto from "./commons/crypto.js";
import * as dnsutil from "./commons/dnsutil.js";
import * as envutil from "./commons/envutil.js";
import * as util from "./commons/util.js";
import { handleRequest } from "./core/doh.js";
import { setTlsVars } from "./core/node/config.js";
import * as nodeutil from "./core/node/util.js";
import { stopAfter, uptime } from "./core/svc.js";
import * as system from "./system.js";

/**
 * @typedef {net.Socket} Socket
 * @typedef {http2.Http2ServerRequest} Http2ServerRequest
 * @typedef {http2.Http2ServerResponse} Http2ServerResponse
 */

let OUR_RG_DN_RE = null; // regular dns name match
let OUR_WC_DN_RE = null; // wildcard dns name match

let log = null;

// todo: as metrics
class Stats {
  constructor() {
    this.noreqs = -1;
    this.nofchecks = 0;
    this.tlserr = 0;
    this.fasttls = 0;
    this.totfasttls = 0;
    this.noftlsadjs = 0;
    this.nofdrops = 0;
    this.nofconns = 0;
    this.openconns = 0;
    this.noftimeouts = 0;
    this.nofheapsnaps = 0;
    // avg1, avg5, avg15, adj, maxconns
    this.bp = [0, 0, 0, 0, 0];
  }

  str() {
    return (
      `reqs=${this.noreqs} c=${this.nofchecks} ` +
      `drops=${this.nofdrops}/tot=${this.nofconns}/open=${this.openconns} ` +
      `to=${this.noftimeouts}/tlserr=${this.tlserr} ` +
      `tls0=${this.fasttls}/tls0miss=${this.totfasttls}/tlsadjs=${this.noftlsadjs} ` +
      `n=${this.bp[4]}/adj=${this.bp[3]} ` +
      `load=${this.bp[0]}/${this.bp[1]}/${this.bp[2]}`
    );
  }
}

class SoReport {
  constructor() {
    /** @type {int} total bytes transferred in preceding 1sec */
    this.tx = 0;
    /** @type {int} unix timestamp in millis */
    this.lastsnd = 0;
  }
}

class ConnW {
  /**
   * @param {Socket|TLSSocket} socket
   */
  constructor(socket) {
    this.socket = socket;
    this.rep = new SoReport();
  }
}

class Tracker {
  constructor() {
    this.zeroid = "";
    /** @type {Array<Map<string, ConnW>>} */
    this.connmap = [];
    this.reports = [];
    /** @type {Array<net.Server>} */
    this.srvs = [];
  }

  valid(id) {
    return id != null && this.zeroid !== id;
  }

  /**
   * @param {net.Server|tls.Server} server
   * @returns {string}
   */
  sid(server) {
    if (!server) return this.zeroid;

    const saddr = server.address();
    if (!saddr || !saddr.port) {
      log.w("trackConn: no addr/port", saddr);
      return this.zeroid;
    }

    return saddr.port + "";
  }

  /**
   * @param {Socket?} sock
   * @returns {string}
   */
  cid(sock) {
    if (!sock || util.emptyString(sock.remoteAddress)) return this.zeroid;
    else return sock.remoteAddress + "|" + sock.remotePort;
  }

  /**
   * @param {string} id
   * @param {net.Server} s
   * @returns {string} sid
   */
  trackServer(id, s) {
    if (!s) return this.zeroid;
    const mapid = this.sid(s);

    if (!this.valid(mapid)) {
      log.w("trackServer: server not tracked", id, mapid);
      return this.zeroid;
    }

    const cmap = this.connmap[mapid];
    if (cmap) {
      log.w("trackServer: server already tracked?", id, mapid);
      return this.zeroid;
    }

    log.i("trackServer: new server", id, mapid);
    this.connmap[mapid] = new Map();
    this.srvs.push(s);
    return mapid;
  }

  *servers() {
    yield* this.srvs;
  }

  *conns() {
    for (const cm of this.connmap) {
      if (!cm) continue;
      yield* cm.values();
    }
  }

  /**
   * @param {net.Server} server
   * @param {Socket} sock
   * @returns {string}
   */
  trackConn(server, sock) {
    // if no servers are being tracked, don't track connections either
    // happens if the server did not start or this.end was called
    if (util.emptyArray(this.srvs)) return this.zeroid;
    if (!server || !server.listening || !sock) return this.zeroid;

    const mapid = this.sid(server);
    const connid = this.cid(sock);
    const cmap = this.connmap[mapid];
    if (!this.valid(mapid) || !this.valid(connid) || !cmap) {
      log.d("trackConn: server/socket not tracked?", mapid, connid);
      return this.zeroid;
    }

    cmap.set(connid, new ConnW(sock));
    sock.on("close", (_haderr) => cmap.delete(connid));

    return connid;
  }

  /**
   *
   * @param {Socket|TLSSocket|null} sock
   * @returns {SoReport?} rep
   */
  sorep(sock) {
    const connid = this.cid(sock);
    if (!this.valid(connid)) return null; // unlikely

    for (const cmap of this.connmap) {
      if (!cmap) continue;
      const connw = cmap.get(connid);
      if (connw != null) return connw.rep;
    }
    return null; // sock not tracked!
  }

  /**
   * @returns {[Array<net.Server>, Array<Map<string, ConnW>>]}
   */
  end() {
    const srvs = this.srvs;
    const cmap = this.connmap;
    this.srvs = [];
    this.connmap = [];
    return [srvs, cmap];
  }
}

// nodejs.org/api/net.html#serverlisten
const zero6 = "::";
const tracker = new Tracker();
const stats = new Stats();
// blog.cloudflare.com/optimizing-tls-over-tcp-to-reduce-latency
// 1369 - (1500 - 1280) = 1149
const tlsStartFragmentSize = 1149; // bytes
const tlsMaxFragmentSize = 16 << 10; // 16kb
const tlsSessions = new LfuCache("tlsSessions", 10000);
const cpucount = os.cpus().length || 1;
const adjPeriodSec = 5;
const maxHeapSnaps = 20;
const maxCertUpdateAttempts = 20;
let adjTimer = null;

((_main) => {
  // listen for "go" and start the server
  system.sub("go", systemUp);
  // listen for "end" and stop the server
  system.sub("stop", systemDown);
  // ask prepare phase to commence
  system.pub("prepare");
})();

function systemDown() {
  // system-down even may arrive even before the process has had the chance
  // to start, in which case globals like env and log may not be available
  const upmins = (uptime() / 60000) | 0;
  console.warn("W rcv stop; uptime", upmins, "mins", stats.str());

  const shutdownTimeoutMs = envutil.shutdownTimeoutMs();
  // servers will start rejecting conns when tracker is empty
  const [srvs, cmap] = tracker.end();

  util.timeout(shutdownTimeoutMs, bye);

  if (adjTimer) clearInterval(adjTimer);
  // 0 is ignored; github.com/nodejs/node/pull/48276
  // accept only 1 conn (which keeps health-checks happy)
  adjustMaxConns(1);

  // drain all sockets stackoverflow.com/a/14636625
  // TODO: handle proxy protocol sockets
  for (const m of cmap) {
    if (!m) continue;
    console.warn("W closing...", m.size, "connections");
    for (const v of m.values()) {
      close(v.socket);
    }
  }

  // stopping net.server only stops incoming reqs; it does not
  // close open sockets: github.com/nodejs/node/issues/2642
  for (const s of srvs) {
    if (!s || !s.listening) continue;
    const saddr = s.address();
    console.warn("W stopping...", saddr);
    s.close(() => down(saddr));
    s.unref();
  }

  // test: util.next(whyIsNodeRunning, bye);
  util.next(bye);
}

function systemUp() {
  log = util.logger("NodeJs");
  if (!log) throw new Error("logger unavailable on system up");

  const downloadmode = envutil.blocklistDownloadOnly();
  const profilermode = envutil.profileDnsResolves();
  const tlsoffload = envutil.isCleartext();
  // todo: tcp backlog for doh/dot servers not supported on bun 1.1
  const tcpbacklog = envutil.tcpBacklog();
  const maxconns = envutil.maxconns();
  // see also: dns-transport.js:ioTimeout
  const ioTimeoutMs = envutil.ioTimeoutMs();
  const supportsHttp2 = envutil.isNode() || envutil.isDeno();
  const isBun = envutil.isBun();

  if (downloadmode) {
    log.i("in download mode, not running the dns resolver");
    return;
  } else if (profilermode) {
    const durationms = 60 * 1000; // 1 min
    log.w("in profiler mode, run for", durationms, "and exit");
    stopAfter(durationms);
  } else {
    adjTimer = util.repeat(adjPeriodSec * 1000, adjustMaxConns);
    log.i(`cpu ${cpucount}, ip ${zero6}, tcpb ${tcpbacklog}, c ${maxconns}`);
  }

  // nodejs.org/api/net.html#netcreateserveroptions-connectionlistener
  /** @type {net.ServerOpts} */
  const serverOpts = {
    keepAlive: true,
    noDelay: true,
  };
  // default cipher suites
  // nodejs.org/api/tls.html#modifying-the-default-tls-cipher-suite
  let defaultTlsCiphers = "";
  if (!util.emptyString(tls.DEFAULT_CIPHERS)) {
    // nodejs.org/api/tls.html#tlsdefault_ciphers
    defaultTlsCiphers = tls.DEFAULT_CIPHERS;
  } else {
    // nodejs.org/api/tls.html#tlsgetciphers
    defaultTlsCiphers = tls
      .getCiphers()
      .map((c) => c.toUpperCase())
      .join(":");
  }
  // aes128 is a 'cipher string' for tls1.2 and below
  // docs.openssl.org/1.1.1/man1/ciphers/#cipher-strings
  const preferAes128 =
    "AES128:TLS_AES_128_CCM_SHA256:TLS_AES_128_CCM_8_SHA256:TLS_AES_128_GCM_SHA256";
  // nodejs.org/api/tls.html#tlscreateserveroptions-secureconnectionlistener
  /** @type {tls.TlsOptions} */
  const tlsOpts = {
    ciphers: preferAes128 + ":" + defaultTlsCiphers,
    honorCipherOrder: true,
    handshakeTimeout: Math.max((ioTimeoutMs / 2) | 0, 3 * 1000), // 3s in ms
    // blog.cloudflare.com/tls-session-resumption-full-speed-and-secure
    sessionTimeout: 60 * 60 * 24 * 7, // 7d in secs
  };
  // nodejs.org/api/http2.html#http2createsecureserveroptions-onrequesthandler
  const h2Opts = {
    allowHTTP1: true,
  };

  if (tlsoffload) {
    // fly.io terminated tls?
    const portdoh = envutil.dohCleartextBackendPort();
    const portdot = envutil.dotCleartextBackendPort();
    /** @type {net.ListenOptions} */
    const dohOpts = { port: portdoh, host: zero6, backlog: tcpbacklog };
    /** @type {net.ListenOptions} */
    const dotOpts = { port: portdot, host: zero6, backlog: tcpbacklog };

    // TODO: ProxyProtoV2 with TLS ClientHello (unsupported by Fly.io, rn)
    // DNS over TLS Cleartext
    const dotct = net.createServer(serverOpts, serveTCP).listen(dotOpts, () => {
      up("DoT Cleartext", dotct.address());
      trapServerEvents("dotct", dotct);
    });

    // DNS over HTTPS Cleartext
    // Same port for http1.1/h2 does not work on node without tls, that is,
    // http2.createServer with opts { ALPNProtocols: ["h2", "http/1.1"],
    // allowHTTP1: true } doesn't handle http1.1 at all (but it does with
    // http2.createSecureServer which involves tls).
    // Ref (for servers): github.com/nodejs/node/issues/34296
    // Ref (for clients): github.com/nodejs/node/issues/31759
    // Impl: stackoverflow.com/a/42019773
    const dohct = h2c
      .createServer(serverOpts, serveHTTPS)
      .listen(dohOpts, () => {
        up("DoH Cleartext", dohct.address());
        trapServerEvents("dohct", dohct);
      });
  } else {
    // terminate tls ourselves
    /** @type {tls.TlsOptions} */
    const secOpts = {
      key: envutil.tlsKey(),
      cert: envutil.tlsCrt(),
      ...tlsOpts,
      ...serverOpts,
    };
    const portdot1 = envutil.dotBackendPort();
    const portdot2 = envutil.dotProxyProtoBackendPort();
    const portdoh = envutil.dohBackendPort();
    /** @type {net.ListenOptions} */
    const dohOpts = { port: portdoh, host: zero6, backlog: tcpbacklog };
    /** @type {net.ListenOptions} */
    const dot1Opts = { port: portdot1, host: zero6, backlog: tcpbacklog };
    /** @type {net.ListenOptions} */
    const dot2Opts = { port: portdot2, host: zero6, backlog: tcpbacklog };
    // DNS over TLS
    const dot1 = tls.createServer(secOpts, serveTLS).listen(dot1Opts, () => {
      up("DoT", dot1.address());
      certUpdateForever(secOpts, dot1);
      trapSecureServerEvents("dot1", dot1);
    });

    // DNS over TLS w ProxyProto
    const dot2 =
      envutil.isDotOverProxyProto() &&
      net.createServer(serverOpts, serveDoTProxyProto).listen(dot2Opts, () => {
        up("DoT ProxyProto", dot2.address());
        trapServerEvents("dot2", dot2);
      });

    // DNS over HTTPS
    if (supportsHttp2) {
      const doh = http2
        .createSecureServer({ ...secOpts, ...h2Opts }, serveHTTPS)
        .listen(dohOpts, () => {
          up("DoH2", doh.address());
          certUpdateForever(secOpts, doh);
          trapSecureServerEvents("doh2", doh);
        });
    } else if (isBun) {
      const doh = https
        .createServer(secOpts, serveHTTPS)
        .listen(dohOpts, () => {
          up("DoH1", doh.address());
          certUpdateForever(secOpts, doh);
          trapSecureServerEvents("doh1", doh);
        });
    } else {
      console.log("unsupported runtime for doh");
    }
  }

  const portcheck = envutil.httpCheckPort();
  const hcheck = h2c.createServer(serve200).listen(portcheck, () => {
    up("http-check", hcheck.address());
    trapServerEvents("hcheck", hcheck);
  });

  heartbeat();
}

/**
 * @param {tls.TlsOptions} secopts
 * @param {tls.Server} s
 * @param {int} n
 */
async function certUpdateForever(secopts, s, n = 0) {
  if (n > maxCertUpdateAttempts) {
    console.error("crt: max update attempts reached", n);
    return false;
  }

  const crtpem = secopts.cert;
  if (bufutil.emptyBuf(crtpem)) {
    return false;
  }

  // nodejs.org/api/tls.html#tlsgetcertificates
  // nodejs.org/api/tls.html#certificate-object
  const crt = new X509Certificate(crtpem);

  if (!crt) return false;
  else logCertInfo(crt);

  const fourHoursMs = 4 * 60 * 60 * 1000; // in ms
  const validUntil = new Date(crt.validTo).getTime() - Date.now();
  if (validUntil > fourHoursMs) {
    console.log("crt: #", n, "update: valid for", validUntil, "ms; not needed");
    util.timeout(validUntil - fourHoursMs, () => certUpdateForever(secopts, s));
    return false;
  }

  const oneMinMs = 60 * 1000; // in ms
  const [latestKey, latestCert] = await nodeutil.replaceKeyCert(crt);
  if (bufutil.emptyBuf(latestKey) || bufutil.emptyBuf(latestCert)) {
    console.error("crt: #", n, "update: no key/cert fetched");
    n = n + 1;
    util.timeout(oneMinMs * n, () => certUpdateForever(secopts, s, n));
    return false;
  }

  const latestcrt = new X509Certificate(latestCert);

  if (!latestcrt) return false;
  else logCertInfo(latestcrt);

  secopts.cert = latestCert;
  secopts.key = latestKey;
  setTlsVars(latestKey, latestCert);

  s.setSecureContext(secopts);

  console.info("crt: #", n, "update: set new cert");
  util.next(() => certUpdateForever(secopts, s));

  return true;
}

/**
 * @param {X509Certificate} crt
 */
function logCertInfo(crt) {
  if (!crt) {
    return;
  }
  console.info(
    crt.serialNumber, // AF163398B8095EA6D273CC9B50E95DC3
    crt.issuer, // C=AT, O=ZeroSSL, CN=ZeroSSL ECC Domain Secure Site CA
    crt.subject, // CN=max.rethinkdns.com
    crt.fingerprint256, // 82:74:47:E6:A1:77:33:CD:1D:40:27:D4:B2:8B:E7:71:11:F9:F1:2C:D4:46:9D:3E:0D:84:89:B9:10:E7:32:5A
    crt.subjectAltName, // DNS:*.basic.rethinkdns.com, DNS:*.pro.rethinkdns.com, DNS:*.sky.rethinkdns.com, DNS:basic.rethinkdns.com, DNS:pro.rethinkdns.com
    crt.validFrom, // "Nov 20 00:00:00 2024 GMT"
    crt.validTo // "Jan 19 23:59:59 2025 GMT"
  );
}

/**
 * @param {string} id
 * @param  {... http2.Http2Server | net.Server} s
 */
function trapServerEvents(id, s) {
  const ioTimeoutMs = envutil.ioTimeoutMs();

  if (!s) return;

  const sid = tracker.trackServer(id, s);

  if (sid === tracker.zeroid) {
    log.w("tcp: may be already tracking server", id);
    return;
  }

  s.on("connection", (/** @type {Socket} */ socket) => {
    stats.nofconns += 1;
    stats.openconns += 1;

    const id = tracker.trackConn(s, socket);
    if (!tracker.valid(id)) {
      log.i("tcp: not tracking; server shutting down?", id);
      close(socket);
      return;
    }

    socket.setTimeout(ioTimeoutMs, () => {
      stats.noftimeouts += 1;
      log.d("tcp: incoming conn timed out; " + id);
      socket.end();
    });

    socket.on("error", (err) => {
      log.d("tcp: incoming conn", id, "closed:", err.message);
      close(socket);
    });

    socket.on("end", () => {
      // TODO: is this needed? this is the default anyway
      socket.end();
    });

    socket.on("close", () => {
      stats.openconns -= 1;
    });
  });

  // emitted when the req is discarded due to maxConnections
  s.on("drop", (_data) => {
    stats.nofdrops += 1;
    stats.nofconns += 1;
  });

  s.on("error", (err) => {
    log.e("tcp: stop! server error; " + err.message, err);
    stopAfter(0);
  });
}

/**
 * @param {string} id
 * @param  {http2.Http2SecureServer | tls.Server} s
 */
function trapSecureServerEvents(id, s) {
  const ioTimeoutMs = envutil.ioTimeoutMs();

  if (!s) return;

  const sid = tracker.trackServer(id, s);

  if (sid === tracker.zeroid) {
    log.w("tls: may be already tracking server", id);
    return;
  }

  // github.com/grpc/grpc-node/blob/e6ea6f517epackages/grpc-js/src/server.ts#L392
  s.on("secureConnection", (/** @type {TLSSocket} */ socket) => {
    stats.nofconns += 1;
    stats.openconns += 1;

    const id = tracker.trackConn(s, socket);
    if (!tracker.valid(id)) {
      log.i("tls: not tracking; server shutting down?", id);
      close(socket);
      return;
    }

    // github.com/nodejs/node-v0.x-archive/issues/6889
    socket.setMaxSendFragment(tlsStartFragmentSize);

    socket.setTimeout(ioTimeoutMs, () => {
      stats.noftimeouts += 1;
      log.d("tls: incoming conn timed out; " + id);
      close(socket);
    });

    // error must be handled by Http2SecureServer
    // github.com/nodejs/node/issues/35824
    socket.on("error", (err) => {
      log.e("tls: incoming conn", id, "closed;", err.message);
      close(socket);
    });

    socket.on("end", () => {
      // client gone, socket half-open at this point
      // close this end of the socket, too
      socket.end();
    });

    socket.on("close", () => {
      stats.openconns -= 1;
    });
  });

  const rottm = util.repeat(86400000 * 7, () => rotateTkt(s)); // 7d
  s.on("close", () => clearInterval(rottm));

  s.on("error", (err) => {
    log.e("tls: stop! server error; " + err.message, err);
    stopAfter(0);
  });

  // bajtos.net/posts/2013-08-07-improve-the-performance-of-the-node-js-https-server
  // session tickets take precedence over session ids; -no_ticket is needed
  // openssl s_client -connect :10000 -reconnect -tls1_2 -no_ticket
  // on bun, since session tickets cannot be set by programs (though may be vended
  // by the runtime itself), session ids may come in handy.
  s.on("newSession", (id, data, next) => {
    const hid = bufutil.hex(id);
    tlsSessions.put(hid, data);
    // log.d("tls: new session;", hid);
    next();
  });

  s.on("resumeSession", (id, next) => {
    const hid = bufutil.hex(id);

    const data = tlsSessions.get(hid) || null;
    // log.d("tls: resume;", hid, "ok?", data != null);
    if (data) stats.fasttls += 1;
    else stats.totfasttls += 1;

    next(/* err*/ null, null);
  });

  // emitted when the req is discarded due to maxConnections
  s.on("drop", (_data) => {
    stats.nofdrops += 1;
    stats.nofconns += 1;
  });

  s.on("tlsClientError", (err, /** @type {TLSSocket} */ tlsSocket) => {
    stats.tlserr += 1;
    // fly tcp healthchecks also trigger tlsClientErrors
    // log.d("tls: client err;", err.message, addrstr(tlsSocket));
    close(tlsSocket);
  });
}

/**
 * @param {tls.Server?} s
 * @returns {void}
 */
function rotateTkt(s) {
  if (envutil.isBun()) return;
  if (!s || !s.listening) return;

  let seed = bufutil.fromB64(envutil.secretb64());
  if (bufutil.emptyBuf(seed)) {
    seed = envutil.tlsKey();
  }
  const d = new Date();
  const cur = d.getUTCFullYear() + " " + d.getUTCMonth(); // 2023 7
  const ctx = cur + envutil.imageRef();

  // tls session resumption with tickets (or ids) reduce the 3.5kb to 6.5kb
  // overhead associated with tls handshake: netsekure.org/2010/03/tls-overhead
  nodecrypto
    .tkt48(seed, ctx)
    .then((k) => s.setTicketKeys(k)) // not supported on bun
    .catch((err) => log.e("tls: ticket rotation failed:", err));
}

function down(addr) {
  console.warn(`W closed: [${addr.address}]:${addr.port}`);
}

function up(server, addr) {
  log.i(server, `listening on: [${addr.address}]:${addr.port}`);
}

/**
 * RST and/or closes tcp socket.
 * @param {Socket | TLSSocket | null} sock
 */
function close(sock) {
  if (!sock || sock.destroyed) return;
  if (sock.connecting) sock.resetAndDestroy();
  else sock.destroySoon();
  sock.unref();
}

/**
 * @param {Http2ServerResponse?} res
 */
function resClose(res) {
  if (res && !res.destroy) res.destroy();
}

/**
 * @param {Http2ServerResponse?} res
 * @returns {Boolean}
 */
function resOkay(res) {
  // determine if res is not destroyed, finished, and is writable
  return res.writable;
}

/**
 * @param {Socket?} sock
 * @returns {Boolean}
 */
function tcpOkay(sock) {
  return sock && sock.writable;
}

/**
 * Creates a duplex pipe between `a` and `b` sockets.
 * @param {Socket?} a
 * @param {Socket?} b
 * @return {Boolean} - true if pipe created, false if error
 */
function proxySockets(a, b) {
  if (!a || !b) return false;
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
    log.d("pp: dot socket ready")
  );

  dotSock.on("error", (e) => {
    log.w("pp: dot socket err", e);
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
      log.e("pp: header invalid / not found =>", chunk);
      close(clientSocket);
      close(dotSock);
      return;
    }

    try {
      // TODO: admission control
      const proto = V2ProxyProtocol.parse(chunk.slice(0, delim));
      log.d(`pp: --> [${proto.source.ipAddress}]:${proto.source.port}`);

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

  clientSocket.on("error", (_e) => {
    log.w("pp: client err, closing");
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

  reset() {
    const b = this.qBuf;
    this.qlenBufOffset = bufutil.recycleBuffer(this.qlenBuf);
    this.qBuf = null;
    this.qBufOffset = 0;
    return b;
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

      // d => *\.max\.rethinkdns\.com
      // wc => true
      // pos => 1
      // match => [a-z0-9-_]*\.max\.rethinkdns\.com
      // reStr => (^[a-z0-9-_]*\.max\.rethinkdns\.com$)
      const d = entry.replaceAll(".", "\\.");
      const wc = d.startsWith("*");
      const pos = wc ? 1 : 0;
      const match = wc ? "[a-z0-9-_]" + d : d;
      const reStr = "(^" + match + "$)";

      arr[pos].push(reStr);

      return arr;
    },
    // [[Regular matches], [Wildcard matches]]
    [[], []]
  );

  // Construct case-insensitive RegEx from the respective array of RE strings.
  // RegExs strings are joined with OR operator, before constructing RegEx.
  // If no RegEx strings are found, a non-matching RegEx `(?!)` is returned.
  const rgDnRE = new RegExp(regExs[0].join("|") || "(?!)", "i");
  const wcDnRE = new RegExp(regExs[1].join("|") || "(?!)", "i");
  log.i("sni:", rgDnRE, wcDnRE);
  return [rgDnRE, wcDnRE];
}

/**
 * Gets flag and hostname from the wildcard domain name.
 * @param {String?} sni - Wildcard SNI
 * @return {<[String, String]>} [flag, hostname] - may be empty strings
 */
function getMetadata(sni) {
  const fakesni = envutil.allowDomainFronting();

  if (util.emptyString(sni)) {
    return ["", fakesni ? "nosni.tld" : ""];
  }
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
    log.d(`flag: "", host: ${sni}`);
    return ["", sni];
  }
}

/**
 * Services a DNS over TLS connection
 * @param {TLSSocket} socket
 */
function serveTLS(socket) {
  const sni = socket.servername;
  if (!envutil.allowDomainFronting()) {
    if (!sni) {
      log.d("no sni, close conn");
      close(socket);
      return;
    }

    if (!OUR_RG_DN_RE || !OUR_WC_DN_RE) {
      [OUR_RG_DN_RE, OUR_WC_DN_RE] = getDnRE(socket);
    }

    const isOurRgDn = OUR_RG_DN_RE.test(sni);
    const isOurWcDn = OUR_WC_DN_RE.test(sni);

    if (!isOurWcDn && !isOurRgDn) {
      log.w("unexpected sni, close conn", sni);
      close(socket);
      return;
    }
  }

  if (false) {
    const tkt = bufutil.hex(socket.getTLSTicket());
    const sess = bufutil.hex(socket.getSession());
    const proto = socket.getProtocol();
    const reused = socket.isSessionReused();
    log.d(`(${proto}), reused? ${reused}; ticket: ${tkt}; sess: ${sess}`);
  }

  const [flag, host] = getMetadata(sni);
  const sb = new ScratchBuffer();

  log.d("----> dot request", flag, host);
  socket.on("data", async (data) => {
    const len = await handleTCPData(socket, data, sb, host, flag);
    adjustTLSFragAfterWrites(socket, len);
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

  log.d("----> dot cleartext request", host, flag);

  socket.on("data", (data) => {
    handleTCPData(socket, data, sb, host, flag);
  });
}

/**
 * Handle DNS over TCP/TLS data stream.
 * @param {Socket} socket
 * @param {ArrayBuffer} chunk - A TCP data segment
 * @param {ScratchBuffer} sb - Scratch buffer
 * @param {String} host - Hostname
 * @param {String} flag - Blocklist Flag
 * @returns {Promise<number>} n - bytes sent
 */
async function handleTCPData(socket, chunk, sb, host, flag) {
  const cl = chunk.byteLength;
  if (cl <= 0) return 0;

  // read header first which contains length(dns-query)
  const rem = dnsutil.dnsHeaderSize - sb.qlenBufOffset;
  if (rem > 0) {
    const seek = Math.min(rem, cl);
    const read = chunk.slice(0, seek);
    sb.qlenBuf.fill(read, sb.qlenBufOffset);
    sb.qlenBufOffset += seek;
  }

  // header has not been read fully, yet; expect more data
  // www.rfc-editor.org/rfc/rfc7766#section-8
  if (sb.qlenBufOffset !== dnsutil.dnsHeaderSize) return 0;

  const qlen = sb.qlenBuf.readUInt16BE();
  if (!dnsutil.validateSize(qlen)) {
    log.w(`tcp: query size err: ql:${qlen} cl:${cl} rem:${rem}`);
    close(socket);
    return 0;
  }

  // rem bytes already read, is any more left in chunk?
  const size = cl - rem;
  if (size <= 0) return 0;
  // gobble up at most qlen bytes from chunk starting rem-th byte
  const qlimit = rem + Math.min(qlen - sb.qBufOffset, size);
  // hopefully fast github.com/nodejs/node/issues/20130#issuecomment-382417255
  // chunk out dns-query starting rem-th byte
  const data = chunk.slice(rem, qlimit);
  // out of band data, if any
  const oob = qlimit < cl ? chunk.slice(qlimit) : null;

  sb.allocOnce(qlen);

  sb.qBuf.fill(data, sb.qBufOffset);
  sb.qBufOffset += data.byteLength;

  log.d(`tcp: q: ${qlen}, sb.q: ${sb.qBufOffset}, cl: ${cl}, sz: ${size}`);
  let n = 0;
  // exactly qlen bytes read till now, handle the dns query
  if (sb.qBufOffset === qlen) {
    // extract out the query and reset the scratch-buffer
    const b = sb.reset();
    n += await handleTCPQuery(b, socket, host, flag);

    // if there is any out of band data, handle it
    if (!bufutil.emptyBuf(oob)) {
      log.d(`tcp: pipelined, handle oob: ${oob.byteLength}`);
      n += await handleTCPData(socket, oob, sb, host, flag);
    }
  } // continue reading from socket
  return n;
}

/**
 * @param {Buffer} q
 * @param {TLSSocket} socket
 * @param {String} host
 * @param {String} flag
 * @returns {Promise<number>} n - bytes sent
 */
async function handleTCPQuery(q, socket, host, flag) {
  heartbeat();

  let n = 0;
  let ok = true;
  if (bufutil.emptyBuf(q) || !tcpOkay(socket)) return 0;

  /** @type {Uint8Array?} */
  let r = null;
  const rxid = util.xid();
  try {
    r = await resolveQuery(rxid, q, host, flag);
    if (bufutil.emptyBuf(r)) {
      log.w(rxid, "tcp: empty ans from resolver");
      ok = false;
    } else {
      const rlBuf = bufutil.encodeUint8ArrayBE(r.byteLength, 2);
      const data = new Uint8Array([...rlBuf, ...r]);
      n = measuredWrite(rxid, socket, data);
    }
  } catch (e) {
    ok = false;
    log.w(rxid, "tcp: send fail, err", e);
  }

  // close socket when !ok
  if (!ok) {
    close(socket);
  } // else: expect pipelined queries on the same socket

  return n;
}

/**
 * @param {string} rxid
 * @param {Socket} socket
 * @param {Uint8Array} data
 * @returns {int} n - bytes written to socket
 */
function measuredWrite(rxid, socket, data) {
  let ok = tcpOkay(socket);
  // writing to a destroyed socket crashes nodejs
  if (!ok) {
    log.w(rxid, "tcp: send fail, socket not writable", bufutil.len(data));
    close(socket);
    return 0;
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
  return bufutil.len(data);
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

function serve200(req, res) {
  log.d("-------------> http-check req", req.method, req.url);
  stats.nofchecks += 1;
  res.writeHead(200);
  res.end();
}

/**
 * Services a DNS over HTTPS connection
 * @param {Http2ServerRequest} req
 * @param {Http2ServerResponse} res
 */
function serveHTTPS(req, res) {
  trapRequestResponseEvents(req, res);
  const ua = req.headers["user-agent"];
  const buffers = [];

  // if using for await loop, then it must be wrapped in a
  // try-catch block: stackoverflow.com/questions/69169226
  // if not, errors from reading req escapes unhandled.
  // for example: req is being read from, but the underlying
  // socket has been the closed (resulting in err_premature_close)
  req.on("data", (chunk) => buffers.push(chunk));

  req.on("end", () => {
    const b = bufutil.concatBuf(buffers);
    const bLen = b.byteLength;

    if (util.isPostRequest(req) && !dnsutil.validResponseSize(b)) {
      res.writeHead(dnsutil.dohStatusCode(b), util.corsHeadersIfNeeded(ua));
      res.end();
      log.w(`h2: req body length out of bounds: ${bLen}`);
    } else {
      log.d("----> doh request", req.method, bLen, req.url);
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
  heartbeat();

  const rxid = util.xid();
  try {
    let host = req.headers.host || req.headers[":authority"];
    if (isIPv6(host)) host = `[${host}]`;

    // nb: req.url is a url-path, for ex: /a/b/c
    const fReq = new Request(new URL(req.url, `https://${host}`), {
      // Note: In a VM container, Object spread may not be working for all
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

    const fRes = await handleRequest(util.mkFetchEvent(fReq));

    if (!resOkay(res)) {
      throw new Error("res not writable 1");
    }

    res.writeHead(fRes.status, util.copyHeaders(fRes));

    // ans may be null on non-2xx responses, such as redirects (3xx) by cc.js
    // or 4xx responses on timeouts or 5xx on invalid http method
    const ans = await fRes.arrayBuffer();
    const sz = bufutil.len(ans);

    if (!resOkay(res)) {
      throw new Error("res not writable 2");
    } else if (sz > 0) {
      adjustTLSFragAfterWrites(res.socket, sz);
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
      log.w("h2: res fin w error", reqstr, resstr, e.message);
    }
  });
  finished(req, (e) => {
    if (e) {
      const reqstr = nodeutil.req2str(req);
      const resstr = nodeutil.res2str(res);
      log.w("h2: req fin w error", reqstr, resstr, e.message);
    }
  });
}

function heartbeat() {
  const minc = envutil.minconns();
  const maxc = envutil.maxconns();
  const isNode = envutil.isNode();
  const notCloud = envutil.onLocal();
  const measureHeap = envutil.measureHeap();
  const freemem = os.freemem() / (1024 * 1024); // in mb
  const totmem = os.totalmem() / (1024 * 1024); // in mb
  // increment no of requests
  stats.noreqs += 1;

  if (stats.noreqs % (minc * 2) === 0) {
    log.i(stats.str(), "in", (uptime() / 60000) | 0, "mins");
  }

  const mul = notCloud ? 2 : 10;
  const writeSnap = notCloud || measureHeap;
  const ramthres = notCloud || freemem < 0.2 * totmem;
  const reqthres = stats.noreqs > 0 && stats.noreqs % (maxc * mul) === 0;
  const withinLimit = stats.nofheapsnaps < maxHeapSnaps;
  if (isNode && writeSnap && withinLimit && reqthres && ramthres) {
    stats.nofheapsnaps += 1;
    const n = "s" + stats.nofheapsnaps + "." + stats.noreqs + ".heapsnapshot";
    const start = Date.now();
    // nodejs.org/en/learn/diagnostics/memory/using-heap-snapshot
    v8.writeHeapSnapshot(n); // blocks event loop!
    const elapsed = (Date.now() - start) / 1000;
    log.i("heap snapshot #", stats.nofheapsnaps, n, "in", elapsed, "s");
  }
}

/**
 * github.com/nodejs/node-v0.x-archive/issues/6889
 * github.com/golang/go/blob/ef3e1dae2f/src/crypto/tls/conn.go#L895
 * @param {TLSSocket?} socket
 * @param {SoReport?} rep
 * @param {int} sz
 */
function adjustTLSFragAfterWrites(socket, sz, rep = tracker.sorep(socket)) {
  if (typeof sz !== "number" || sz <= 0) return; // also skip lastsnd
  if (socket == null || !(socket instanceof TLSSocket)) return;
  if (rep == null) return;

  const now = Date.now();
  if (now - rep.lastsnd > 1000) {
    // reset tx time threshold: 1s
    socket.setMaxSendFragment(tlsStartFragmentSize);
    rep.tx = sz;
  } else if (rep.tx > tlsStartFragmentSize * 1000) {
    stats.noftlsadjs += 1;

    // boost upto max thres: 1139 * 1000 = ~128kb or ~1000 frags
    socket.setMaxSendFragment(tlsMaxFragmentSize);
  } // else: adaptively set to (sz * est fragments rcvd so far)
  rep.lastsnd = now;
  rep.tx += sz;
  // socket.setMaxSendFragment(sz * sb.tx/tlsStartFragmentSize)
}

function adjustMaxConns(n) {
  const isNode = envutil.isNode();
  const notCloud = envutil.onLocal();
  const maxc = envutil.maxconns();
  const minc = envutil.minconns();
  const adjsPerSec = 60 / adjPeriodSec;

  // caveats:
  // linux-magazine.com/content/download/62593/485442/version/1/file/Load_Average.pdf
  // brendangregg.com/blog/2017-08-08/linux-load-averages.html
  // linuxjournal.com/article/9001
  let [avg1, avg5, avg15] = os.loadavg();
  avg1 = ((avg1 * 100) / cpucount) | 0;
  avg5 = ((avg5 * 100) / cpucount) | 0;
  avg15 = ((avg15 * 100) / cpucount) | 0;

  const freemem = os.freemem() / (1024 * 1024); // in mb
  const totmem = os.totalmem() / (1024 * 1024); // in mb
  const lowram = freemem < 0.1 * totmem;
  const verylowram = freemem < 0.025 * totmem;

  let adj = stats.bp[3] || 0;
  // increase in load
  if (avg5 > 90) {
    adj += 3;
  } else if (avg1 > 100) {
    adj += 2;
  } else if (avg1 > avg5) {
    adj += 1;
  }
  if (n == null) {
    // determine n based on load-avg
    n = maxc;
    if (avg1 > 100) {
      n = minc;
    } else if (avg1 > 90 || avg5 > 80 || lowram) {
      n = Math.max((n * 0.2) | 0, minc);
    } else if (avg1 > 80 || avg5 > 75) {
      n = Math.max((n * 0.4) | 0, minc);
    } else if (avg1 > 70) {
      n = Math.max((n * 0.6) | 0, minc);
    } else {
      // reclaim adjs 25% at a time as n approaches maxconns
      // ex: if adj is 100, then the decay would be,
      // [75, 56, 42, 31, 23, 17, 12, 9, 6, 4, 3, 2, 1, 0]
      adj = Math.max(0, adj * 0.75) | 0;
    }
  } else {
    // clamp n based on a preset
    n = Math.min(maxc, n);
    n = Math.max(minc, n);
    // n adjusts as per client input, not load avg
    adj = 0;
  }

  // adjustMaxConns is called every adjPeriodSec
  const breakpoint = 6 * adjsPerSec; // 6 mins
  const stresspoint = 4 * adjsPerSec; // 4 mins
  const nstr = stats.openconns + "/" + n;
  if (adj > breakpoint || (verylowram && !notCloud)) {
    log.w("load: verylowram! freemem:", freemem, "totmem:", totmem);
    log.w("load: stopping lowram?", verylowram, "; n:", nstr, "adjs:", adj);
    stopAfter(0);
    return;
  } else if (adj > stresspoint) {
    log.w("load: stress; lowram?", lowram, "mem:", freemem, " / ", totmem);
    log.w("load: stress; n:", nstr, "adjs:", adj, "avgs:", avg1, avg5, avg15);
    n = (minc / 2) | 0;
  } else if (adj > 0) {
    log.d("load: high; lowram?", lowram, "mem:", freemem, " / ", totmem);
    log.d("load: high; n:", nstr, "adjs:", adj, "avgs:", avg1, avg5, avg15);
  }

  stats.bp = [avg1, avg5, avg15, adj, n];
  for (const s of tracker.servers()) {
    if (!s || !s.listening) continue;
    s.maxConnections = n;
  }

  // nodejs.org/en/docs/guides/diagnostics/memory/using-gc-traces
  if (adj > 0) {
    if (isNode) v8.setFlagsFromString("--trace-gc");
  } else {
    if (isNode) v8.setFlagsFromString("--notrace-gc");
  }
}

function bye() {
  // in some cases, node stops listening but the process doesn't exit because
  // of other unreleased resources (see: svc.js#systemStop); and so exit with
  // success (exit code 0) regardless; ref: community.fly.io/t/4547/6
  console.warn("W game over");

  if (envutil.isNode()) v8.writeHeapSnapshot("snap.end.heapsnapshot");

  process.exit(0);
}
