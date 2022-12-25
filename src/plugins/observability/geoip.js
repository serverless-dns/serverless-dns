/*
 * Copyright (c) 2022 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { LfuCache } from "@serverless-dns/lfu-cache";
import * as bufutil from "../../commons/bufutil.js";
import * as envutil from "../../commons/envutil.js";
import * as util from "../../commons/util.js";

const debug = false;

const ip6sep = ":";
const ip4sep = ".";
const ip6size = 16;
const ip4size = 4;

const dbip4 = "dbip.v4";
const dbip6 = "dbip.v6";

// unknown country code
const ccunknown = "ZZ";
// country code size
const ccsize = 2;
// stop search for country-code beyond this depth in the geo4 / geo6
const maxdepth = 32;

// wait time in ms, before rechecking if geoip is initialized
const waitms = 50;
// max wait time in ms, before giving up on geoip initialization
const maxwaitms = 5000;

// geoip cache size
const size = 20000;

export class GeoIP {
  constructor() {
    this.geo4 = null;
    this.geo6 = null;
    this.initializing = false;
    this.decoder = new TextDecoder();
    this.repo = envutil.geoipUrl();
    this.cache = new LfuCache("GeoIP", size);
    this.log = log.withTags("GeoIP");
  }

  initDone() {
    return !bufutil.emptyBuf(this.geo4) && !bufutil.emptyBuf(this.geo6);
  }

  async download(force = false) {
    if (!force && this.initDone()) {
      return Promise.all([this.geo4, this.geo6]);
    }

    this.log.d("downloading geoip dbs", this.repo);
    const [f1, f2] = await Promise.all([
      fetch(this.repo + dbip4),
      fetch(this.repo + dbip6),
    ]);

    if (!f1.ok || !f2.ok) throw new Error("geoip download failed");

    return Promise.all([f1.arrayBuffer(), f2.arrayBuffer()]);
  }

  async init(g4, g6) {
    if (this.initDone()) return true;

    let totalsleep = 0;
    while (this.initializing && totalsleep < maxwaitms) {
      await util.sleep(waitms);
      totalsleep += waitms;
    }

    this.initializing = true;
    if (g4 == null || g6 == null) {
      [g4, g6] = await this.download();
      const sz4 = this.geo4 && this.geo4.byteLength;
      const sz6 = this.geo4 && this.geo6.byteLength;
      this.log.d("downloading geoip dbs done", sz4, sz6);
    }
    this.geo4 = bufutil.normalize8(g4);
    this.geo6 = bufutil.normalize8(g6);

    this.initializing = false;

    return this.initDone();
  }

  country(ipstr) {
    if (!this.initDone()) return ccunknown;
    if (util.emptyString(ipstr)) return ccunknown;

    const cached = this.cache.get(ipstr);
    if (!util.emptyObj(cached)) {
      return cached;
    }

    const ip = this.iptou8(ipstr);
    const recsize = ip.length + ccsize;
    const g = ip.length === 4 ? this.geo4 : this.geo6;

    let low = 0;
    let high = g.byteLength / recsize;
    let i = 0;
    while (high - 1 > low) {
      const mid = ((high + low) / 2) | 0;
      const midpos = mid * recsize;

      if (debug) this.log.d(i, "nexti", mid, "<mid, l/h>", low, high);

      if (this.lessthan(g, midpos, ip)) low = mid;
      else high = mid;

      if (i++ > maxdepth) break;
    }

    const pos = low * recsize + ip.length;
    const raw = g.subarray(pos, pos + ccsize);
    const cc = this.decoder.decode(raw);

    this.cache.put(ipstr, cc);

    if (debug) this.log.d(low, high, "<l/h | pos>", pos, raw, "cc", cc);

    return cc;
  }

  lessthan(g, w, ip) {
    for (let i = 0; i < ip.length; i++) {
      const gi = g[w + i];
      const ii = ip[i];
      if (debug) this.log.d(i, "<i | w>", w, gi, "<bi | ii>", ii);
      if (gi > ii) return false;
      if (ii > gi) return true;
    }
    return true;
  }

  iptou8(ip) {
    if (ip.indexOf(ip6sep) > 0) {
      const ip6 = ip.split(ip6sep);
      const ip6u8 = new Uint8Array(ip6size);
      for (let i = 0; i < ip6size; i++) {
        ip6u8[i] = parseInt(ip6[i], 16) | 0;
      }
      return ip6u8;
    } else {
      const ip4 = ip.split(ip4sep);
      const ip4u8 = new Uint8Array(ip4size);
      for (let i = 0; i < ip4size; i++) {
        ip4u8[i] = parseInt(ip4[i]) | 0;
      }
      return ip4u8;
    }
  }
}
