/*
 * Copyright (c) 2022 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as dnsutil from "../../commons/dnsutil.js";
import * as util from "../../commons/util.js";
import { log } from "../../core/log.js";
import * as pres from "../plugin-response.js";

// eslint-disable-next-line max-len
// from: github.com/DNSCrypt/dnscrypt-proxy/blob/10ded3d9f/dnscrypt-proxy/plugin_block_undelegated.go
const undelegated = new Set([
  // eslint-disable-next-line max-len
  "0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.ip6.arpa",
  "0.in-addr.arpa",
  "1",
  // eslint-disable-next-line max-len
  "1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.ip6.arpa",
  "10.in-addr.arpa",
  "100.100.in-addr.arpa",
  "100.51.198.in-addr.arpa",
  "101.100.in-addr.arpa",
  "102.100.in-addr.arpa",
  "103.100.in-addr.arpa",
  "104.100.in-addr.arpa",
  "105.100.in-addr.arpa",
  "106.100.in-addr.arpa",
  "107.100.in-addr.arpa",
  "108.100.in-addr.arpa",
  "109.100.in-addr.arpa",
  "110.100.in-addr.arpa",
  "111.100.in-addr.arpa",
  "112.100.in-addr.arpa",
  "113.0.203.in-addr.arpa",
  "113.100.in-addr.arpa",
  "114.100.in-addr.arpa",
  "115.100.in-addr.arpa",
  "116.100.in-addr.arpa",
  "117.100.in-addr.arpa",
  "118.100.in-addr.arpa",
  "119.100.in-addr.arpa",
  "120.100.in-addr.arpa",
  "121.100.in-addr.arpa",
  "122.100.in-addr.arpa",
  "123.100.in-addr.arpa",
  "124.100.in-addr.arpa",
  "125.100.in-addr.arpa",
  "126.100.in-addr.arpa",
  "127.100.in-addr.arpa",
  "127.in-addr.arpa",
  "16.172.in-addr.arpa",
  "168.192.in-addr.arpa",
  "17.172.in-addr.arpa",
  "18.172.in-addr.arpa",
  "19.172.in-addr.arpa",
  "2.0.192.in-addr.arpa",
  "20.172.in-addr.arpa",
  "21.172.in-addr.arpa",
  "22.172.in-addr.arpa",
  "23.172.in-addr.arpa",
  "24.172.in-addr.arpa",
  "25.172.in-addr.arpa",
  "254.169.in-addr.arpa",
  "255.255.255.255.in-addr.arpa",
  "26.172.in-addr.arpa",
  "27.172.in-addr.arpa",
  "28.172.in-addr.arpa",
  "29.172.in-addr.arpa",
  "30.172.in-addr.arpa",
  "31.172.in-addr.arpa",
  "64.100.in-addr.arpa",
  "65.100.in-addr.arpa",
  "66.100.in-addr.arpa",
  "67.100.in-addr.arpa",
  "68.100.in-addr.arpa",
  "69.100.in-addr.arpa",
  "70.100.in-addr.arpa",
  "71.100.in-addr.arpa",
  "72.100.in-addr.arpa",
  "73.100.in-addr.arpa",
  "74.100.in-addr.arpa",
  "75.100.in-addr.arpa",
  "76.100.in-addr.arpa",
  "77.100.in-addr.arpa",
  "78.100.in-addr.arpa",
  "79.100.in-addr.arpa",
  "8.b.d.0.1.0.0.2.ip6.arpa",
  "8.e.f.ip6.arpa",
  "80.100.in-addr.arpa",
  "81.100.in-addr.arpa",
  "82.100.in-addr.arpa",
  "83.100.in-addr.arpa",
  "84.100.in-addr.arpa",
  "85.100.in-addr.arpa",
  "86.100.in-addr.arpa",
  "87.100.in-addr.arpa",
  "88.100.in-addr.arpa",
  "89.100.in-addr.arpa",
  "9.e.f.ip6.arpa",
  "90.100.in-addr.arpa",
  "91.100.in-addr.arpa",
  "92.100.in-addr.arpa",
  "93.100.in-addr.arpa",
  "94.100.in-addr.arpa",
  "95.100.in-addr.arpa",
  "96.100.in-addr.arpa",
  "97.100.in-addr.arpa",
  "98.100.in-addr.arpa",
  "99.100.in-addr.arpa",
  "a.e.f.ip6.arpa",
  "airdream",
  "api",
  "b.e.f.ip6.arpa",
  "bbrouter",
  "belkin",
  "bind",
  "blinkap",
  "corp",
  "d.f.ip6.arpa",
  "davolink",
  "dearmyrouter",
  "dhcp",
  "dlink",
  "domain",
  "envoy",
  "example",
  "f.f.ip6.arpa",
  "grp",
  "gw==",
  "home",
  "hub",
  "internal",
  "intra",
  "intranet",
  "invalid",
  "ksyun",
  "lan",
  "loc",
  "local",
  "localdomain",
  "localhost",
  "localnet",
  "modem",
  "mynet",
  "myrouter",
  "novalocal",
  "onion",
  "openstacklocal",
  "priv",
  "private",
  "prv",
  "router",
  "telus",
  "test",
  "totolink",
  "wlan_ap",
  "workgroup",
  "zghjccbob3n0",
]);

export class DNSPrefilter {
  constructor() {
    this.log = log.withTags("DnsPrefilter");
  }

  async close() {
    // no-op
  }

  /**
   * @param {{rxid: string, requestDecodedDnsPacket: any}} ctx
   * @returns {Promise<pres.RResp>}
   */
  async exec(ctx) {
    let r = pres.emptyResponse();

    try {
      r.data = await this.filterOut(ctx.requestDecodedDnsPacket);
    } catch (e) {
      r = pres.errResponse("dnsPrefilter", e);
      this.log.e(ctx.rxid, "main", e);
    }

    return r;
  }

  async filterOut(dnsPacket) {
    // set a dummy flag, "prefilter"
    const block = pres.rdnsBlockResponse("prefilter");
    const allow = pres.rdnsNoBlockResponse();
    const domains = dnsutil.extractDomains(dnsPacket);

    // domains is a Set
    for (const d of domains) {
      const subdomains = d.split(".");
      do {
        if (util.emptyArray(subdomains)) break;
        const fqdn = subdomains.join(".");
        if (undelegated.has(fqdn)) {
          return block;
        }
      } while (subdomains.shift() != null);
    }

    return allow;
  }
}
