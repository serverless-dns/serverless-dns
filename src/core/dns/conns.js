/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as util from "../../commons/util.js";

export class TcpConnPool {
  constructor(size, ttl) {
    this.size = size;
    this.ttl = ttl; // ms
    this.keepalive = Math.min(/* 60s*/ 60000, Math.ceil(ttl / 2)); // ms
    this.pool = new Map();
  }

  give(socket) {
    if (socket.pending) return false;
    if (socket.destroyed) return false;
    if (!this.ready(socket)) return false;

    if (this.pool.has(socket)) return true;

    const free = this.pool.size < this.size || this.sweep();
    if (!free) return false;

    return this.checkin(socket);
  }

  take() {
    for (const [sock, report] of this.pool) {
      if (this.healthy(sock, report)) {
        return this.checkout(sock, report);
      } else this.evict(sock);
    }
    return null;
  }

  checkout(sock, report) {
    log.d(report.id, "checkout, size:", this.pool.size);

    sock.removeListener("close", report.reap);
    sock.setKeepAlive(false);
    sock.resume();

    this.pool.delete(sock);

    return sock;
  }

  checkin(sock) {
    const report = this.mkreport(sock);
    this.pool.set(sock, report);

    sock.on("close", report.reap);
    sock.setKeepAlive(true, this.keepalive);
    sock.pause();

    log.d(report.id, "checkin, size:", this.pool.size);
    return true;
  }

  sweep() {
    const start = this.pool.size;
    for (const [sock, report] of this.pool) {
      if (this.dead(sock, report)) this.evict(sock);
    }
    return start > this.pool.size; // size decreased post-sweep?
  }

  ready(sock) {
    return sock.readyState === "open";
  }

  healthy(sock, report) {
    const destroyed = sock.destroyed;
    const open = this.ready(sock);
    const fresh = report.lastuse + this.ttl >= Date.now();
    const id = report.id;
    log.d(id, "destroyed?", destroyed, "open?", open, "fresh?", fresh);
    if (destroyed || !open) return false;
    return fresh; // healthy if not expired
  }

  dead(sock, report) {
    return !healthy(sock, report);
  }

  evict(sock) {
    try {
      if (sock && !sock.destroyed) util.safeBox(() => sock.destroy());
    } catch (ignore) {}
    this.pool.delete(sock);
  }

  mkreport(sock) {
    const that = this;
    return {
      id: "tcp" + util.uid(),
      lastuse: Date.now(),
      reap: function () {
        that.evict(sock);
      },
    };
  }
}

export class UdpConnPool {
  constructor(size, ttl) {
    this.size = size;
    this.ttl = Math.max(60000, ttl); // no more than 60s
    this.pool = new Map();
  }

  give(socket) {
    if (this.pool.has(socket)) return true;

    const free = this.pool.size < this.size || this.sweep();
    if (!free) return false;

    return this.checkin(socket);
  }

  take() {
    for (const [sock, report] of this.pool) {
      if (this.healthy(sock, report)) {
        return this.checkout(sock, report);
      } else {
        this.evict(sock);
      }
    }
    return null;
  }

  checkout(sock, report) {
    log.d(report.id, "checkout, size:", this.pool.size);

    sock.removeListener("close", report.reap);
    sock.removeListener("error", report.reap);

    this.pool.delete(sock);

    return sock;
  }

  checkin(sock) {
    const report = this.mkreport(sock);
    this.pool.set(sock, report);

    sock.on("close", report.reap);
    sock.on("error", report.reap);

    log.d(report.id, "checkin, size:", this.pool.size);
    return true;
  }

  sweep() {
    const start = this.pool.size;
    for (const [sock, report] of this.pool) {
      if (this.dead(sock, report)) this.evict(sock);
    }
    return start > this.pool.size; // size decreased post-sweep?
  }

  healthy(sock, report) {
    const fresh = report.lastuse + this.ttl >= Date.now();
    const id = report.id;
    log.d(id, "fresh?", fresh);
    return fresh; // healthy if not expired
  }

  dead(sock, report) {
    return !healthy(sock, report);
  }

  evict(sock) {
    util.safeBox(() => sock.disconnect());
    util.safeBox(() => sock.close());
    this.pool.delete(sock);
  }

  mkreport(sock) {
    const that = this;
    return {
      id: "udp" + util.uid(),
      lastuse: Date.now(),
      reap: function () {
        that.evict(sock);
      },
    };
  }
}
