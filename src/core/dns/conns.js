/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as util from "../../commons/util.js";

/**
 * @typedef {import("net").Socket | import("dgram").Socket} AnySock
 */

export class TcpConnPool {
  constructor(size, ttl) {
    this.size = size;
    // max sweeps per give/take
    this.maxsweep = Math.max((size / 4) | 0, 20);
    this.ttl = ttl; // ms
    const quarterttl = (ttl / 4) | 0;
    this.keepalive = Math.min(/* 60s*/ 60000, quarterttl); // ms
    this.lastSweep = 0;
    this.sweepGapMs = Math.max(/* 10s*/ 10000, quarterttl); // ms
    /** @type {Map<import("net").Socket, Report>} */
    this.pool = new Map();
    log.d("tcp-pool psz:", size, "msw:", this.maxsweep, "t:", ttl);
  }

  give(socket) {
    if (socket.pending) return false;
    if (!socket.writable) return false;
    if (!this.ready(socket)) return false;

    if (this.pool.has(socket)) return true;

    const free = this.pool.size < this.size || this.sweep();
    if (!free) return false;

    return this.checkin(socket);
  }

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
   * @param {import("net").Socket} sock
   * @param {Report} report
   * @returns {import("net").Socket}
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

  ready(sock) {
    return sock.readyState === "open";
  }

  healthy(sock, report) {
    const destroyed = !sock.writable;
    const open = this.ready(sock);
    const fresh = report.fresh(this.ttl);
    const id = report.id;
    log.d(id, "destroyed?", destroyed, "open?", open, "fresh?", fresh);
    if (destroyed || !open) return false;
    return fresh; // healthy if not expired
  }

  dead(sock, report) {
    return !this.healthy(sock, report);
  }

  evict(sock) {
    this.pool.delete(sock);

    try {
      if (sock && !sock.destroyed) sock.destroySoon();
    } catch (ignore) {}
  }

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

  fresh(since) {
    return this.lastuse + since >= Date.now();
  }
}

export class UdpConnPool {
  constructor(size, ttl) {
    this.size = size;
    this.maxsweep = Math.max((size / 4) | 0, 20);
    this.ttl = Math.max(/* 60s*/ 60000, ttl); // no more than 60s
    this.lastSweep = 0;
    this.sweepGapMs = Math.max(/* 10s*/ 10000, (ttl / 2) | 0); // ms
    /** @type {Map<import("dgram").Socket, Report>} */
    this.pool = new Map();
    log.d("udp-pool psz:", size, "msw:", this.maxsweep, "t:", ttl);
  }

  give(socket) {
    if (this.pool.has(socket)) return true;

    const free = this.pool.size < this.size || this.sweep();
    if (!free) return false;

    return this.checkin(socket);
  }

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
   * @param {import("dgram").Socket} sock
   * @param {Report} report
   * @returns {import("dgram").Socket}
   */
  checkout(sock, report) {
    log.d(report.id, "checkout, size:", this.pool.size);

    sock.removeAllListeners("close");
    sock.removeAllListeners("error");

    this.pool.delete(sock);
    return sock;
  }

  checkin(sock) {
    const report = this.mkreport();

    sock.on("close", this.evict.bind(this));
    sock.on("error", this.evict.bind(this));

    this.pool.set(sock, report);

    log.d(report.id, "checkin, size:", this.pool.size);
    return true;
  }

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

  healthy(report) {
    const fresh = report.fresh(this.ttl);
    const id = report.id;
    log.d(id, "fresh?", fresh);
    return fresh; // healthy if not expired
  }

  dead(report) {
    return !this.healthy(report);
  }

  evict(sock) {
    if (!sock) return;
    this.pool.delete(sock);

    sock.disconnect();
    sock.close();
  }

  mkreport() {
    return new Report(util.uid("udp"));
  }
}
