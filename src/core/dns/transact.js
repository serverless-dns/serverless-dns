/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as bufutil from "../../commons/bufutil.js";
import * as dnsutil from "../../commons/dnsutil.js";
import * as util from "../../commons/util.js";
import { log } from "../log.js";

/**
 * @typedef {import("net").Socket} TcpSock
 * @typedef {import("dgram").Socket} UdpSock
 * @typedef {import("net").AddressInfo} AddrInfo
 */

// TcpTx implements a single DNS question-answer exchange over TCP. It doesn't
// multiplex multiple DNS questions over the same socket. It doesn't take the
// ownership of the socket, but requires exclusive use of it. The socket may
// close itself on errors, however.
export class TcpTx {
  /** @param {TcpSock} socket */
  constructor(socket) {
    /** @type {TcpSock} */
    this.sock = socket;
    /** @type {boolean} */
    this.done = false || socket == null; // done gates all other requests
    /** @type {ScratchBuffer} */
    // reads from the socket is buffered into scratch
    this.readBuffer = this.makeReadBuffer();
    /** @type {function(Buffer)} */
    this.resolve = null;
    /** @type {function(string?)} */
    this.reject = null;
    this.log = log.withTags("TcpTx");
  }

  /** @param {TcpSock} sock */
  static begin(sock) {
    return new TcpTx(sock);
  }

  /**
   * @param {string} rxid
   * @param {Buffer} query
   * @param {int} timeout
   * @returns {Promise<Buffer>|null}
   */
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
      this.onError(rxid, err);
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

  /**
   * @param {string} rxid
   * @param {Buffer} chunk
   * @returns
   */
  onData(rxid, chunk) {
    const cl = bufutil.len(chunk);

    // TODO: Same code as in server.js, merge them
    if (this.done) {
      this.log.w(rxid, "on reads, tx closed; discard", cl);
      return chunk;
    }

    const sb = this.readBuffer;

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

  onClose(rxid, err) {
    if (this.done) return; // no-op
    return err ? this.no(err.message) : this.no("close");
  }

  onError(rxid, err) {
    if (this.done) return; // no-op
    this.log.e(rxid, "udp err", err.message);
    this.no(err.message);
  }

  onTimeout(rxid) {
    if (this.done) return; // no-op
    this.no("timeout");
  }

  /** @returns {Promise<Buffer>} */
  promisedRead() {
    const that = this;
    return new Promise((resolve, reject) => {
      that.resolve = resolve;
      that.reject = reject;
    });
  }

  /**
   * @param {string} rxid
   * @param {Buffer} query
   */
  write(rxid, query) {
    const qlen = bufutil.len(query);
    if (this.done) {
      this.log.w(rxid, "no writes, tx is done; discard", qlen);
      return query;
    }

    const header = bufutil.createBuffer(dnsutil.dnsHeaderSize);
    const hlen = bufutil.len(header);
    bufutil.recycleBuffer(header);
    header.writeUInt16BE(qlen);

    this.sock.write(header, () => {
      this.log.d(rxid, "tcp write hdr:", hlen);
    });
    this.sock.write(query, () => {
      this.log.d(rxid, "tcp write q:", qlen);
    });
  }

  /**
   * @param {Buffer} val
   */
  yes(val) {
    this.done = true;
    this.resolve(val);
  }

  /**
   * @param {string?|Error} reason
   */
  no(reason) {
    this.done = true;
    this.reject(reason);
  }

  /** @returns {ScratchBuffer} */
  makeReadBuffer() {
    return new ScratchBuffer();
  }
}

class ScratchBuffer {
  constructor() {
    /** @type {Buffer} */
    this.qlenBuf = bufutil.createBuffer(dnsutil.dnsHeaderSize);
    /** @type {int} */
    this.qlenBufOffset = bufutil.recycleBuffer(this.qlenBuf);
    /** @type {Buffer} */
    this.qBuf = null;
    /** @type {int} */
    this.qBufOffset = 0;
  }
}

// UdpTx implements a single DNS question-answer exchange over UDP. It does not
// multiplex multiple DNS queries over the same socket. It doesn't take the
// ownership of the socket, but requires exclusive access to it. The socket
// may close itself on errors, however.
export class UdpTx {
  /** @param {UdpSock} socket */
  constructor(socket) {
    /** @type {UdpSock} */
    this.sock = socket;
    /** @type {boolean} */
    this.done = false || socket == null; // only one transaction allowed
    /** @type {NodeJS.Timeout|-1} */
    this.timeoutTimerId = null; // ticks socket io timeout
    /** @type {function(Buffer)} */
    this.resolve = null;
    /** @type {function(string)} */
    this.reject = null;
    this.log = log.withTags("UdpTx");
  }

  /** @param {UdpSock} sock */
  static begin(sock) {
    return new UdpTx(sock);
  }

  /**
   * @param {string} rxid
   * @param {Buffer} query
   * @param {int} timeout
   * @returns {Promise<Buffer>|null}
   */
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

  /**
   * @param {string} rxid
   * @param {Buffer} query
   * @returns
   */
  write(rxid, query) {
    if (this.done) return; // discard
    this.log.d(rxid, "udp write", bufutil.len(query));
    this.sock.send(query); // err-on-write handled by onError
  }

  /**
   * @param {string} rxid
   * @param {Buffer} b
   * @param {AddrInfo} addrinfo
   * @returns
   */
  onMessage(rxid, b, addrinfo) {
    if (this.done) return; // discard
    this.log.d(rxid, "udp read", bufutil.len(b));
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

  /**
   * @param {int} timeout
   * @returns {Promise<Buffer>}
   */
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

  /** @param {Buffer} val */
  yes(val) {
    if (this.done) return;

    this.done = true;
    clearTimeout(this.timeoutTimerId);
    this.resolve(val);
  }

  /** @param {string|Error} reason */
  no(reason) {
    if (this.done) return;

    this.done = true;
    clearTimeout(this.timeoutTimerId);
    this.reject(reason);
  }
}
