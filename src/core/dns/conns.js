/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as util from "../../commons/util.js";
import { log } from "../log.js";

/**
 * @typedef {import("node:net").Socket | import("node:dgram").Socket} AnySock
 */

export class TcpConnPool {
  /**
   * @param {int} size
   * @param {int} ttl
   */
  constructor(size, ttl) {
    /** @type {int} */
    this.size = size;
    /**
     * max sweeps per give/take
     * @type {int}
     */
    this.maxsweep = Math.max((size / 4) | 0, 20);
    /** @type {int} */
    this.ttl = ttl; // ms
    const quarterttl = (ttl / 4) | 0;
    /** @type {int} */
    this.keepalive = Math.min(/* 60s*/ 60000, quarterttl); // ms
    /** @type {int} */
    this.lastSweep = 0;
    /** @type {int} */
    this.sweepGapMs = Math.max(/* 10s*/ 10000, quarterttl); // ms
    /** @type {Map<import("node:net").Socket, Report>} */
    this.pool = new Map();
    log.d("tcp-pool psz:", size, "msw:", this.maxsweep, "t:", ttl);
  }

  /**
   * @param {AnySock} socket
   * @returns {boolean}
   */
  give(socket) {
    if (socket.pending) return false;
    if (!socket.writable) return false;
    if (!this.ready(socket)) return false;

    if (this.pool.has(socket)) return true;

    const free = this.pool.size < this.size || this.sweep();
    if (!free) return false;

    return this.checkin(socket);
  }

  /**
   * @returns {AnySock?}
   */
  take() {
    const thres = this.maxsweep / 2;
    let out = null;
    let n = 0;

    const sz = this.pool.size;
    if (sz <= 0) return out;

    for (const [sock, report] of this.pool) {
      if (this.healthy(sock, report)) {
        out = this.checkout(sock, report);
      } else {
        this.evict(sock);
      }
      if (++n >= thres) break;
      if (out) break;
    }

    // no evictions, and no free sockets
    if (n > 0 || out == null) {
      log.d("take, evicted:", n, "out?", out != null);
    } else if (n > 0) {
      this.lastSweep = Date.now();
    }
    return out;
  }

  /**
   * @param {AnySock} sock
   * @param {Report} report
   * @returns {AnySock}
   */
  checkout(sock, report) {
    log.d(report.id, "checkout, size:", this.pool.size);

    try {
      sock.removeAllListeners("close");
      sock.removeAllListeners("error");
      sock.setKeepAlive(false);
      sock.resume();
    } catch (ignore) {
      this.evict(sock);
      return null;
    }
    this.pool.delete(sock);
    return sock;
  }

  /**
   * @param {AnySock} socket
   * @returns {boolean}
   */
  checkin(sock) {
    const report = this.mkreport();

    sock.setKeepAlive(true, this.keepalive);
    sock.pause();
    sock.on("close", this.evict.bind(this));
    sock.on("error", this.evict.bind(this));

    this.pool.set(sock, report);

    log.d(report.id, "checkin, size:", this.pool.size);
    return true;
  }

  /**
   * @param {boolean} clear
   * @returns {boolean}
   */
  sweep(clear = false) {
    const sz = this.pool.size;
    if (sz <= 0) return false;

    const now = Date.now();
    if (this.lastSweep + this.sweepGapMs > now) {
      if (!clear) return false;
    }
    this.lastSweep = now;

    let n = 0;
    for (const [sock, report] of this.pool) {
      if (clear || this.dead(sock, report)) this.evict(sock);
      // incr n even if we are clearing (ignoring maxsweep)
      if (++n >= this.maxsweep && !clear) break;
    }
    log.i("sweep, cleared:", sz - this.pool.size, "clear?", clear, "n:", n);
    return sz > this.pool.size; // size decreased post-sweep?
  }

  /**
   * @param {AnySock?} socket
   * @returns {boolean}
   */
  ready(sock) {
    return sock && sock.readyState === "open";
  }

  /**
   * @param {AnySock?} sock
   * @param {Report} report
   * @returns {boolean}
   */
  healthy(sock, report) {
    if (!sock) return false;
    const destroyed = !sock.writable;
    const open = this.ready(sock);
    const fresh = report.fresh(this.ttl);
    const id = report.id;
    log.d(id, "destroyed?", destroyed, "open?", open, "fresh?", fresh);
    if (destroyed || !open) return false;
    return fresh; // healthy if not expired
  }

  /**
   * @param {AnySock} sock
   * @param {Report} report
   * @returns {boolean}
   */
  dead(sock, report) {
    return !this.healthy(sock, report);
  }

  /**
   * @param {AnySock?} sock
   */
  evict(sock) {
    this.pool.delete(sock);

    try {
      if (sock && !sock.destroyed) sock.destroySoon();
    } catch (ignore) {}
  }

  /** @return {Report} */
  mkreport() {
    return new Report(util.uid("tcp"));
  }
}

class Report {
  /**
   * @param {string} id
   */
  constructor(id) {
    /** @type {string} */
    this.id = id;
    /** @type {number} */
    this.lastuse = Date.now();
  }

  /** @param {number} since */
  fresh(since) {
    return this.lastuse + since >= Date.now();
  }
}

export class UdpConnPool {
  /**
   * @param {int} size
   * @param {int} ttl
   */
  constructor(size, ttl) {
    /** @type {int} */
    this.size = size;
    /** @type {int} */
    this.maxsweep = Math.max((size / 4) | 0, 20);
    /** @type {int} */
    this.ttl = Math.max(/* 60s*/ 60000, ttl); // no more than 60s
    /** @type {int} */
    this.lastSweep = 0;
    /** @type {int} */
    this.sweepGapMs = Math.max(/* 10s*/ 10000, (ttl / 2) | 0); // ms
    /** @type {Map<import("node:dgram").Socket, Report>} */
    this.pool = new Map();
    log.d("udp-pool psz:", size, "msw:", this.maxsweep, "t:", ttl);
  }

  /**
   * @param {AnySock?} socket
   * @returns {boolean}
   */
  give(socket) {
    if (!socket) return false;
    if (this.pool.has(socket)) return true;

    const free = this.pool.size < this.size || this.sweep();
    if (!free) return false;

    return this.checkin(socket);
  }

  /**
   * @returns {AnySock?}
   */
  take() {
    const thres = this.maxsweep / 2;
    let out = null;
    let n = 0;

    const sz = this.pool.size;
    if (sz <= 0) return out;

    for (const [sock, report] of this.pool) {
      if (this.healthy(report)) {
        out = this.checkout(sock, report);
      } else {
        this.evict(sock);
      }
      if (++n >= thres) break;
      if (out) break;
    }
    // no evictions, but no socket available
    if (n > 0 || out == null) {
      log.d("take, evicted:", n, "out?", out != null);
    } else if (n > 0) {
      this.lastSweep = Date.now();
    }
    return out;
  }

  /**
   * @param {AnySock} sock
   * @param {Report} report
   * @returns {AnySock}
   */
  checkout(sock, report) {
    log.d(report.id, "checkout, size:", this.pool.size);

    sock.removeAllListeners("close");
    sock.removeAllListeners("error");

    this.pool.delete(sock);
    return sock;
  }

  /**
   * @param {AnySock} socket
   * @returns {boolean}
   */
  checkin(sock) {
    const report = this.mkreport();

    sock.on("close", this.evict.bind(this));
    sock.on("error", this.evict.bind(this));

    this.pool.set(sock, report);

    log.d(report.id, "checkin, size:", this.pool.size);
    return true;
  }

  /**
   * @param {boolean} clear
   * @returns {boolean}
   */
  sweep(clear = false) {
    const sz = this.pool.size;
    if (sz <= 0) return false;

    const now = Date.now();
    if (this.lastSweep + this.sweepGapMs > now) {
      if (!clear) return false;
    }
    this.lastSweep = now;

    let n = 0;
    for (const [sock, report] of this.pool) {
      if (clear || this.dead(report)) this.evict(sock);
      // incr n even if we are clearing (ignoring maxsweep)
      if (++n >= this.maxsweep && !clear) break;
    }
    log.i("sweep, cleared:", sz - this.pool.size, "clear?", clear, "n:", n);
    return sz > this.pool.size; // size decreased post-sweep?
  }

  /**
   * @param {Report} report
   * @returns {boolean}
   */
  healthy(report) {
    const fresh = report.fresh(this.ttl);
    const id = report.id;
    log.d(id, "fresh?", fresh);
    return fresh; // healthy if not expired
  }

  /**
   * @param {Report} report
   * @returns {boolean}
   */
  dead(report) {
    return !this.healthy(report);
  }

  /**
   * @param {AnySock?} sock
   */
  evict(sock) {
    if (!sock) return;
    this.pool.delete(sock);

    sock.disconnect();
    sock.close();
  }

  /** @return {Report} */
  mkreport() {
    return new Report(util.uid("udp"));
  }
}
