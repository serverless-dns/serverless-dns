/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as util from "../util.js"
import * as dnsutil from "../dnsutil.js"

export class TcpTx {

  constructor(socket) {
    this.sock = socket
    // only one transaction allowed
    // then done gates all other requests
    this.done = false
    // reads from the socket is buffered into scratch
    this.readBuffer = this.makeReadBuffer()
  }

  static begin(sock) {
    return new Tx(sock)
  }

  async exchange(query, timeout) {
    if (this.done) {
      log.w("no exchange, tx is done")
      return query
    }

    const onData = (b) => {
      this.onData(b)
    }
    const onClose = (err) => {
      this.onClose(err)
    }
    const onTimeout = () => {
      this.onTimeout()
    }

    try {
      const ans = this.promisedRead()

      this.sock.setTimeout(timeout)
      this.sock.on("data", onData)
      this.sock.on("close", onClose)
      this.sock.on("timeout", onTimeout)

      this.write(query)

      return await ans

    } finally {
      this.sock.setTimeout(0)
      this.sock.removeListener("data", onData)
      this.sock.removeListener("close", onClose)
      this.sock.removeListener("timeout", onTimeout)
    }
  }

  // TODO: Same code as in server.js, merge them
  onData(chunk) {
    if (this.done) {
      log.w("on reads, tx is closed for business")
      return chunk
    }

    const socket = this.sock
    const sb = this.readBuffer

    const cl = chunk.byteLength
    if (cl <= 0) return

    // read header first which contains length(dns-query)
    const rem = dnsutil.dnsHeaderSize - sb.qlenBufOffset
    if (rem > 0) {
      const seek = Math.min(rem, cl)
      const read = chunk.slice(0, seek)
      sb.qlenBuf.fill(read, sb.qlenBufOffset)
      sb.qlenBufOffset += seek
    }

    // header has not been read fully, yet
    if (sb.qlenBufOffset !== dnsutil.dnsHeaderSize) return

    const qlen = sb.qlenBuf.readUInt16BE()
    if (qlen < dnsutil.minDNSPacketSize || qlen > dnsutil.maxDNSPacketSize) {
      log.w(`query range err: ql:${qlen} cl:${cl} rem:${rem}`)
      this.no("out-of-bounds")
      return
    }

    // rem bytes already read, is any more left in chunk?
    const size = cl - rem
    if (size <= 0) return

    // hopefully fast github.com/nodejs/node/issues/20130#issuecomment-382417255
    // chunk out dns-query starting rem-th byte
    const data = chunk.slice(rem)

    if (sb.qBuf === null) {
      sb.qBuf = util.createBuffer(qlen)
      sb.qBufOffset = util.recycleBuffer(sb.qBuf)
    }

    sb.qBuf.fill(data, sb.qBufOffset)
    sb.qBufOffset += size

    // exactly qlen bytes read, the complete answer
    if (sb.qBufOffset === qlen) {
      this.yes(sb.qBuf)
      // reset qBuf and qlenBuf states
      sb.qlenBufOffset = util.recycleBuffer(sb.qlenBuf)
      sb.qBuf = null
      sb.qBufOffset = 0
      return
    } else if (sb.qBufOffset > qlen) {
      log.w(`size mismatch: ${chunk.byteLength} <> ${qlen}`)
      this.no("size-mismatch")
      return
    } // continue reading from socket
  }

  onClose(err) {
    if (this.done) return // no-op
    return (err) ? this.no("error") : this.no("close")
  }

  onTimeout() {
    if (this.done) return // no-op
    this.no("timeout")
  }

  promisedRead() {
    const that = this
    return new Promise((resolve, reject) => {
      that.resolve = resolve
      that.reject = reject
    })
  }

  write(query) {
    if (this.done) {
      log.w("no writes, tx is done working")
      return query
    }

    const header = util.createBuffer(dnsutil.dnsHeaderSize);
    util.recycleBuffer(header);
    header.writeUInt16BE(query.byteLength)

    this.sock.write(header, () => { log.d("len(header):", header.byteLength) })
    this.sock.write(query, () => { log.d("len(query):", query.byteLength) })
  }

  yes(val) {
    this.done = true
    this.resolve(val)
  }

  no(reason) {
    this.done = true
    this.reject(reason)
  }

  makeReadBuffer() {
    const qlenBuf = util.createBuffer(dnsutil.dnsHeaderSize)
    const qlenBufOffset = util.recycleBuffer(qlenBuf)

    return {
      qlenBuf: qlenBuf,
      qlenBufOffset: qlenBufOffset,
      qBuf: null,
      qBufOffset: 0,
    }
  }
}

export class UdpTx {

  constructor(socket) {
    this.sock = socket
    // only one transaction allowed
    this.done = false
  }

  static begin(sock) {
    return new UdpTx(sock)
  }

  // TODO: timeouts using util.timedOp
  async exchange(query, timeout) {
    if (this.done) {
      log.w("no exchange, tx is done")
      return query
    }

    const onMessage = (b, addrinfo) => {
      this.onMessage(b, addrinfo)
    }
    const onClose = (err) => {
      this.onClose(err)
    }
    const onError = (err) => {
      this.onError(err)
    }

    try {
      const ans = this.promisedRead()

      this.sock.on("message", onMessage)
      this.sock.on("close", onClose)
      this.sock.on("error", onError)

      this.write(query)

      return await ans

    } finally {
      this.sock.removeListener("message", onMessage)
      this.sock.removeListener("close", onClose)
      this.sock.removeListener("error", onError)
    }
  }

  write(query) {
    this.sock.send(query) // err-on-write handled by onError
  }

  onMessage(b, addrinfo) {
    this.yes(b)
  }

  onError(err) {
    if (err) this.no(err.message)
  }

  onClose(err) {
    if (err) this.no(err.message)
  }

  promisedRead() {
    const that = this
    return new Promise((resolve, reject) => {
      that.resolve = resolve
      that.reject = reject
    })
  }

  yes(val) {
    this.done = true
    this.resolve(val)
  }

  no(reason) {
    this.done = true
    this.reject(reason)
  }

}
