/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import net from "net";
import dgram from "dgram";
import * as util from "../../commons/util.js";
import { TcpConnPool, UdpConnPool } from "../dns/conns.js";
import { TcpTx, UdpTx } from "../dns/transact.js";

export function makeTransport(host, port, opts = {}) {
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
    this.host = host;
    this.port = port;
    this.connectTimeout = opts.connectTimeout || 3000; // 3s
    this.ioTimeout = opts.ioTimeout || 10000; // 10s
    this.ipproto = net.isIP(host); // 4, 6, or 0
    const sz = opts.poolSize || 500; // conns
    const ttl = opts.poolTtl || 60000; // 1m
    this.tcpconns = new TcpConnPool(sz, ttl);
    this.udpconns = new UdpConnPool(sz, ttl);

    this.log = log.withTags("DnsTransport");
    this.log.i(this.ipproto, "W transport", host, port, "pool", sz, ttl);
  }

  async teardown() {
    const r1 = this.tcpconns.sweep(true);
    const r2 = this.udpconns.sweep(true);
    this.log.i("transport teardown (tcp | udp) done?", r1, "|", r2);
  }

  async udpquery(rxid, q) {
    let sock = this.udpconns.take();
    this.log.d(rxid, "udp pooled?", sock !== null);

    const t = this.log.startTime("udp-query");
    let ans = null;
    try {
      sock = sock || (await this.makeConn("udp"));
      this.log.lapTime(t, rxid, "make-conn");

      ans = await UdpTx.begin(sock).exchange(rxid, q, this.ioTimeout);
      this.log.lapTime(t, rxid, "get-ans");

      this.parkConn(sock, "udp");
    } catch (ex) {
      this.closeUdp(sock);
      this.log.e(rxid, ex);
    }
    this.log.endTime(t);

    return ans;
  }

  async tcpquery(rxid, q) {
    let sock = this.tcpconns.take();
    this.log.d(rxid, "tcp pooled?", sock !== null);

    const t = this.log.startTime("tcp-query");
    let ans = null;
    try {
      sock = sock || (await this.makeConn("tcp"));
      log.lapTime(t, rxid, "make-conn");

      ans = await TcpTx.begin(sock).exchange(rxid, q, this.ioTimeout);
      log.lapTime(t, rxid, "get-ans");

      this.parkConn(sock, "tcp");
    } catch (ex) {
      this.closeTcp(sock);
      this.log.e(rxid, ex);
    }
    this.log.endTime(t);

    return ans;
  }

  parkConn(sock, proto) {
    if (proto === "tcp") {
      const ok = this.tcpconns.give(sock);
      if (!ok) this.closeTcp(sock);
    } else if (proto === "udp") {
      const ok = this.udpconns.give(sock);
      if (!ok) this.closeUdp(sock);
    }
  }

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
   * @param {import("net").Socket} sock
   */
  closeTcp(sock) {
    // the socket is not expected to have any error-listeners
    // so we add one to avoid unhandled errors
    sock.on("error", util.stub);
    if (sock && !sock.destroyed) util.safeBox(() => sock.destroySoon());
  }

  /**
   * @param {import("dgram").Socket} sock
   */
  closeUdp(sock) {
    // the socket is expected to not have any error-listeners
    // so we add one just in case to avoid unhandled errors
    sock.on("error", util.stub);
    if (sock) util.safeBox(() => sock.disconnect());
    if (sock) util.safeBox(() => sock.close());
  }
}
