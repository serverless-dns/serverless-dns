/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import dgram from "node:dgram";
import net from "node:net";
import * as util from "../../commons/util.js";
import { TcpConnPool, UdpConnPool } from "../dns/conns.js";
import { TcpTx, UdpTx } from "../dns/transact.js";
import { log } from "../log.js";

/**
 * @typedef {import("net").Socket | import("dgram").Socket} AnySock
 * @typedef {import("net").Socket} TcpSock
 * @typedef {import("dgram").Socket} UdpSock
 */

/**
 *
 * @param {string} host
 * @param {int} port
 * @param {any} opts
 * @returns {Transport}
 */
export function makeTransport(host, port = 53, opts = {}) {
  return new Transport(host, port, opts);
}

// Transport upstreams plain-old DNS queries over both UDPv4 and TCPv4.
// Host and port constructor parameters are IPv4 addresses of the upstream.
// TCP and UDP connections are pooled for reuse, but DNS queries are not
// multiplexed. IO timeout, connection pool size, connection expiry are other
// constructor parameters to configure the pooling behaviour. Methods udpquery
// and tcpquery are the main entry points which forward a raw dns-packet as
// and return non-null dns-answers, if recieved on-time and without errors.
export class Transport {
  constructor(host, port, opts = {}) {
    if (util.emptyString(host)) throw new Error("invalid host" + host);
    /** @type {string} */
    this.host = host;
    /** @type {int} */
    this.port = port || 53;
    /** @type {int} */
    this.connectTimeout = opts.connectTimeout || 3000; // 3s
    /** @type {int} */
    this.ioTimeout = opts.ioTimeout || 10000; // 10s
    /** @type {int} */
    this.ipproto = net.isIP(host); // 4, 6, or 0
    const sz = opts.poolSize || 500; // conns
    const ttl = opts.poolTtl || 60000; // 1m
    /** @type {TcpConnPool} */
    this.tcpconns = new TcpConnPool(sz, ttl);
    /** @type {UdpConnPool} */
    this.udpconns = new UdpConnPool(sz, ttl);

    this.log = log.withTags("DnsTransport");
    this.log.i(this.ipproto, "W transport", host, port, "pool", sz, ttl);
  }

  async teardown() {
    const r1 = this.tcpconns.sweep(true);
    const r2 = this.udpconns.sweep(true);
    this.log.i("transport teardown (tcp | udp) done?", r1, "|", r2);
  }

  /**
   * @param {string} rxid
   * @param {Buffer} q
   * @returns {Promise<Buffer>|null}
   */
  async udpquery(rxid, q) {
    let sock = this.udpconns.take();
    this.log.d(rxid, "udp pooled?", sock !== null);

    /** @type {Buffer?} */
    let ans = null;
    try {
      sock = sock || (await this.makeConn("udp"));
      ans = await UdpTx.begin(sock).exchange(rxid, q, this.ioTimeout);
      this.parkConn(sock, "udp");
    } catch (ex) {
      this.closeUdp(sock);
      this.log.e(rxid, ex);
    }
    return ans;
  }

  /**
   * @param {string} rxid
   * @param {Buffer} q
   * @returns {Promise<Buffer>|null}
   */
  async tcpquery(rxid, q) {
    let sock = this.tcpconns.take();
    this.log.d(rxid, "tcp pooled?", sock != null);

    /** @type {Buffer?} */
    let ans = null;
    try {
      sock = sock || (await this.makeConn("tcp"));
      ans = await TcpTx.begin(sock).exchange(rxid, q, this.ioTimeout);
      this.parkConn(sock, "tcp");
    } catch (ex) {
      this.closeTcp(sock);
      this.log.e(rxid, ex);
    }

    return ans;
  }

  /**
   * @param {AnySock} sock
   * @param {string} proto
   */
  parkConn(sock, proto) {
    if (proto === "tcp") {
      const ok = this.tcpconns.give(sock);
      if (!ok) this.closeTcp(sock);
    } else if (proto === "udp") {
      const ok = this.udpconns.give(sock);
      if (!ok) this.closeUdp(sock);
    }
  }

  /**
   * @param {string} proto
   * @returns {Promise<AnySock>}
   * @throws {Error}
   */
  makeConn(proto) {
    if (proto === "tcp") {
      const tcpconnect = (cb) => {
        // not monitoring connection-error events, instead relying on timeouts
        const sock = net.connect(this.port, this.host, () => cb(sock));
      };
      return util.timedOp(tcpconnect, this.connectTimeout, this.closeTcp);
    } else if (proto === "udp") {
      // connected udp-sockets: archive.is/JJxaV
      const udpconnect = (cb) => {
        let sock = null;
        if (this.ipproto === 6) {
          sock = dgram.createSocket("udp6");
        } else {
          // default
          sock = dgram.createSocket("udp4");
        }
        // connect error, if any, is sent to the connection-callback
        sock.connect(this.port, this.host, (err) => cb(sock, err));
      };
      return util.timedOp(udpconnect, this.connectTimeout, this.closeUdp);
    } else {
      throw new Error("unsupported proto: " + proto);
    }
  }

  /**
   * @param {TcpSock?} sock
   */
  closeTcp(sock) {
    if (!sock) return;
    // the socket is not expected to have any error-listeners
    // so we add one to avoid unhandled errors
    sock.on("error", util.stub);
    if (!sock.destroyed) sock.destroySoon();
  }

  /**
   * @param {UdpSock?} sock
   */
  closeUdp(sock) {
    if (!sock || sock.destroyed) return;
    // the socket is expected to not have any error-listeners
    // so we add one just in case to avoid unhandled errors
    sock.on("error", util.stub);
    sock.disconnect();
    sock.close();
  }
}
