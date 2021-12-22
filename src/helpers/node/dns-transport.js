/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as dnsutil from "../dnsutil.js"
import * as util from "../util.js"
import { TcpConnPool, UdpConnPool } from "../dns/conns.js"
import { TcpTx, UdpTx } from "../dns/transact.js"
import net from "net";
import dgram from "dgram";

export class Transport {

  constructor(host, port, opts = {}) {
    this.host = host
    this.port = port
    this.connectTimeout = opts.connectTimeout || 3000 // 3s
    this.ioTimeout = opts.ioTimeout || 10000 // 10s
    const poolSize = opts.poolSize || 100 // conns
    const poolTtl = opts.poolTtl || 60000 // 1m
    this.tcpconns = new TcpConnPool(poolSize, poolTtl)
    this.udpconns = new UdpConnPool(poolSize, poolTtl)
    log.i("transport", host, port, "pool", poolSize, poolTtl)
  }

  async udpquery(q) {
    let sock = this.udpconns.take()
    log.d("udp pooled?", sock !== null)

    const t = log.startTime("udp-query")
    let ans = null
    try {
      sock = sock || await this.makeConn("udp")
      log.lapTime(t, "make-conn")

      ans = await UdpTx.begin(sock).exchange(q, this.ioTimeout)
      log.lapTime(t, "get-ans")

      this.parkConn(sock, "udp")
    } catch(ex) {
      this.closeUdp(sock)
      log.e(ex)
    }
    log.endTime(t)

    return ans
  }

  async tcpquery(q) {
    let sock = this.tcpconns.take()
    log.d("tcp pooled?", sock !== null)

    const t = log.starttime("tcp-query")
    let ans = null
    try {
      sock = sock || await this.makeConn("tcp")
      log.laptime(t, "make-conn")

      ans = await TcpTx.begin(sock).exchange(q, this.ioTimeout)
      log.laptime(t, "get-ans")

      this.parkConn(sock, "tcp")
    } catch(ex) {
      this.closeTcp(sock)
      log.e(ex)
    }
    log.endtime(t)

    return ans
  }

  parkConn(sock, proto) {
    if (proto === "tcp") {
      const ok = this.tcpconns.give(sock)
      if (!ok) this.closeTcp(sock)
    } else if (proto === "udp") {
      const ok = this.udpconns.give(sock)
      if (!ok) this.closeUdp(sock)
    }
  }

  makeConn(proto) {
    if (proto === "tcp") {
      const tcpconnect = (cb) => {
        // not monitoring connection-error events, instead relying on timeouts
        const sock = net.connect(this.port, this.host, () => cb(sock))
      }
      return util.timedOp(tcpconnect, this.connectTimeout, this.closeTcp)
    } else if (proto === "udp") {
      const udpconnect = (cb) => {
        const sock = dgram.createSocket("udp4")
        // connect error, if any, is sent to the connection-callback
        sock.connect(this.port, this.host, (err) => cb(sock, err))
      }
      return util.timedOp(udpconnect, this.connectTimeout, this.closeUdp)
    } else {
      throw new Error("unsupported proto: " + proto)
    }
  }

  closeTcp(sock) {
    if (sock && !sock.destroyed) util.safeBox(() => sock.destroy())
  }

  closeUdp(sock) {
    if (sock) util.safeBox(() => sock.close())
  }

}

