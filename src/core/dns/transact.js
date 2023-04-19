/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as bufutil from "../../commons/bufutil.js";
import * as util from "../../commons/util.js";
import * as dnsutil from "../../commons/dnsutil.js";

// TcpTx implements a single DNS question-answer exchange over TCP. It doesn't
// multiplex multiple DNS questions over the same socket. It doesn't take the
// ownership of the socket, but requires exclusive use of it. The socket may
// close itself on errors, however.
export class TcpTx {
  constructor(socket) {
    this.sock = socket;
    // only one transaction allowed
    // then done gates all other requests
    this.done = false;
    // reads from the socket is buffered into scratch
    this.readBuffer = this.makeReadBuffer();
    this.log = log.withTags("TcpTx");
  }

  static begin(sock) {
    return new TcpTx(sock);
  }

  async exchange(rxid, query, timeout) {
    if (this.done) {
      this.log.w(rxid, "no exchange, tx is done");
      return null;
    }

    const onData = (b) => {
      this.onData(rxid, b);
    };
    const onClose = (err) => {
      this.onClose(rxid, err);
    };
    const onTimeout = () => {
      this.onTimeout(rxid);
    };
    const onError = (err) => {
      this.onError(rxid);
    };

    try {
      const ans = this.promisedRead();

      this.sock.on("timeout", onTimeout);
      this.sock.setTimeout(timeout);
      this.sock.on("error", onError);
      this.sock.on("close", onClose);
      this.sock.on("data", onData);

      this.write(rxid, query);

      return await ans;
    } finally {
      this.sock.setTimeout(0);
      this.sock.removeListener("data", onData);
      this.sock.removeListener("timeout", onTimeout);
      this.sock.removeListener("close", onClose);
      this.sock.removeListener("error", onError);
    }
  }

  // TODO: Same code as in server.js, merge them
  onData(rxid, chunk) {
    if (this.done) {
      this.log.w(rxid, "on reads, tx is closed for business");
      return chunk;
    }

    const sb = this.readBuffer;

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
    if (qlen < dnsutil.minDNSPacketSize || qlen > dnsutil.maxDNSPacketSize) {
      this.log.w(rxid, `query range err: ql:${qlen} cl:${cl} rem:${rem}`);
      this.no("out-of-bounds");
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

    // exactly qlen bytes read, the complete answer
    if (sb.qBufOffset === qlen) {
      this.yes(sb.qBuf);
      // reset qBuf and qlenBuf states
      sb.qlenBufOffset = bufutil.recycleBuffer(sb.qlenBuf);
      sb.qBuf = null;
      sb.qBufOffset = 0;
      return;
    } else if (sb.qBufOffset > qlen) {
      this.log.w(rxid, `size mismatch: ${chunk.byteLength} <> ${qlen}`);
      this.no("size-mismatch");
      return;
    } // continue reading from socket
  }

  onClose(err) {
    if (this.done) return; // no-op
    return err ? this.no("error") : this.no("close");
  }

  onError(err) {
    if (this.done) return; // no-op
    this.log.e(rxid, "udp err", err.message);
    this.no(err.message);
  }

  onTimeout() {
    if (this.done) return; // no-op
    this.no("timeout");
  }

  promisedRead() {
    const that = this;
    return new Promise((resolve, reject) => {
      that.resolve = resolve;
      that.reject = reject;
    });
  }

  write(rxid, query) {
    if (this.done) {
      this.log.w(rxid, "no writes, tx is done working");
      return query;
    }

    const header = bufutil.createBuffer(dnsutil.dnsHeaderSize);
    bufutil.recycleBuffer(header);
    header.writeUInt16BE(query.byteLength);

    this.sock.write(header, () => {
      this.log.d(rxid, "len(header):", header.byteLength);
    });
    this.sock.write(query, () => {
      this.log.d(rxid, "len(query):", query.byteLength);
    });
  }

  yes(val) {
    this.done = true;
    this.resolve(val);
  }

  no(reason) {
    this.done = true;
    this.reject(reason);
  }

  makeReadBuffer() {
    const qlenBuf = bufutil.createBuffer(dnsutil.dnsHeaderSize);
    const qlenBufOffset = bufutil.recycleBuffer(qlenBuf);

    return {
      qlenBuf: qlenBuf,
      qlenBufOffset: qlenBufOffset,
      qBuf: null,
      qBufOffset: 0,
    };
  }
}

// UdpTx implements a single DNS question-answer exchange over UDP. It does not
// multiplex multiple DNS queries over the same socket. It doesn't take the
// ownership of the socket, but requires exclusive access to it. The socket
// may close itself on errors, however.
export class UdpTx {
  constructor(socket) {
    this.sock = socket;
    // only one transaction allowed
    this.done = false;
    // ticks socket io timeout
    this.timeoutTimerId = null;
    this.log = log.withTags("UdpTx");
  }

  static begin(sock) {
    return new UdpTx(sock);
  }

  async exchange(rxid, query, timeout) {
    if (this.done) {
      this.log.w(rxid, "no exchange, tx is done");
      return null;
    }

    const onMessage = (b, addrinfo) => {
      this.onMessage(rxid, b, addrinfo);
    };
    const onClose = (err) => {
      this.onClose(rxid, err);
    };
    const onError = (err) => {
      this.onError(rxid, err);
    };

    try {
      const ans = this.promisedRead(timeout);

      this.sock.on("error", onError);
      this.sock.on("close", onClose);
      this.sock.on("message", onMessage);

      this.write(rxid, query);

      return await ans;
    } finally {
      this.sock.removeListener("message", onMessage);
      this.sock.removeListener("close", onClose);
      this.sock.removeListener("error", onError);
    }
  }

  write(rxid, query) {
    if (this.done) return; // discard
    this.log.d(rxid, "udp write");
    this.sock.send(query); // err-on-write handled by onError
  }

  onMessage(rxid, b, addrinfo) {
    if (this.done) return; // discard
    this.log.d(rxid, "udp read");
    this.yes(b);
  }

  onError(rxid, err) {
    if (this.done) return; // no-op
    this.log.e(rxid, "udp err", err.message);
    this.no(err.message);
  }

  onClose(rxid, err) {
    if (this.done) return; // no-op
    this.log.d(rxid, "udp close");
    return err ? this.no("error") : this.no("close");
  }

  promisedRead(timeout = 0) {
    const that = this;
    if (timeout > 0) {
      that.timeoutTimerId = util.timeout(timeout, () => {
        that.no("timeout");
      });
    }
    return new Promise((resolve, reject) => {
      that.resolve = resolve;
      that.reject = reject;
    });
  }

  yes(val) {
    if (this.done) return;

    this.done = true;
    clearTimeout(this.timeoutTimerId);
    this.resolve(val);
  }

  no(reason) {
    if (this.done) return;

    this.done = true;
    clearTimeout(this.timeoutTimerId);
    this.reject(reason);
  }
}
