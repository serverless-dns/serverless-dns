/*
 * Copyright (c) 2022 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// env config at top, so if .env file variables are used, it is available to
// other modules.
import "./core/deno/config.ts";
import { handleRequest } from "./core/doh.js";
import { stopAfter, uptime } from "./core/svc.js";
import * as system from "./system.js";
import * as util from "./commons/util.js";
import * as bufutil from "./commons/bufutil.js";
import * as dnsutil from "./commons/dnsutil.js";
import * as envutil from "./commons/envutil.js";

let log: any = null;
let listeners: Array<any> = [];

((main) => {
  system.sub("go", systemUp);
  system.sub("stop", systemDown);
  // ask prepare phase to commence
  system.pub("prepare");
})();

function systemDown() {
  // system-down even may arrive even before the process has had the chance
  // to start, in which case globals like env and log may not be available
  console.info("rcv stop signal; uptime", uptime() / 1000, "secs");

  const srvs = listeners;
  listeners = [];

  srvs.forEach((s) => {
    if (!s) return;
    console.info("stopping...");
    // Deno.lisenters are closed, while Deno.Servers are aborted
    if (typeof s.close === "function") s.close();
    else if (typeof s.abort === "function") s.abort();
    else console.warn("unknown server type", s);
  });

  util.timeout(/* 2s*/ 2 * 1000, () => {
    console.info("game over");
    // exit success aka 0; ref: community.fly.io/t/4547/6
    Deno.exit(0);
  });
}

function systemUp() {
  log = util.logger("Deno");
  if (!log) throw new Error("logger unavailable on system up");

  const downloadmode = envutil.blocklistDownloadOnly() as boolean;
  const profilermode = envutil.profileDnsResolves() as boolean;
  if (downloadmode) {
    log.i("in download mode, not running the dns resolver");
    return;
  } else if (profilermode) {
    const durationms = 60 * 1000;
    log.w("in profiler mode, run for", durationms, "and exit");
    stopAfter(durationms);
  }

  const abortctl = new AbortController();
  const onDenoDeploy = envutil.onDenoDeploy() as boolean;
  const isCleartext = envutil.isCleartext() as boolean;
  const dohConnOpts = { port: envutil.dohBackendPort() };
  const dotConnOpts = { port: envutil.dotBackendPort() };
  const sigOpts = {
    signal: abortctl.signal,
    onListen: undefined,
  };

  const crtpath = envutil.tlsCrtPath() as string;
  const keypath = envutil.tlsKeyPath() as string;
  const dotls = !onDenoDeploy && !isCleartext;

  const tlsOpts = dotls
    ? {
        // docs.deno.com/runtime/reference/migration_guide/
        cert: Deno.readTextFileSync(crtpath),
        key: Deno.readTextFileSync(keypath),
      }
    : { cert: "", key: "" };
  // deno.land/manual@v1.18.0/runtime/http_server_apis_low_level
  const httpOpts = {
    alpnProtocols: ["h2", "http/1.1"],
  };

  startDoh();
  startDotIfPossible();

  // docs.deno.com/runtime/fundamentals/http_server
  // docs.deno.com/api/deno/~/Deno.serve
  function startDoh() {
    if (terminateTls()) {
      Deno.serve(
        {
          ...dohConnOpts,
          ...tlsOpts,
          ...httpOpts,
          ...sigOpts,
        },
        serveDoh
      );
    } else {
      Deno.serve({ ...dohConnOpts, ...sigOpts }, serveDoh);
    }

    up("DoH", abortctl, dohConnOpts);
  }

  async function startDotIfPossible() {
    // No DoT on Deno Deploy which supports only http workloads
    if (onDenoDeploy) return;

    // doc.deno.land/deno/stable/~/Deno.listenTls
    // doc.deno.land/deno/stable/~/Deno.listen
    const dot = terminateTls()
      ? Deno.listenTls({ ...dotConnOpts, ...tlsOpts })
      : Deno.listen({ ...dotConnOpts });

    up("DoT (no blocklists)", dot, dotConnOpts);

    // deno.land/manual@v1.11.3/runtime/http_server_apis#handling-connections
    for await (const conn of dot) {
      log.d("DoT conn:", conn.remoteAddr);

      // to not block the server and accept further conns, do not await
      serveTcp(conn);
    }
  }

  function up(p: string, s: any, opts: any) {
    log.i("up", p, opts, "tls?", terminateTls());
    // 's' may be a Deno.Listener or std:http/Server
    listeners.push(s);
  }

  function terminateTls() {
    if (onDenoDeploy) return false;
    if (envutil.isCleartext() as boolean) return false;
    if (util.emptyString(tlsOpts.key)) return false;
    if (util.emptyString(tlsOpts.cert)) return false;
    return true;
  }
}

function serveDoh(req: Request) {
  try {
    // doc.deno.land/deno/stable/~/Deno.RequestEvent
    // deno.land/manual/runtime/http_server_apis#http-requests-and-responses
    return handleRequest(util.mkFetchEvent(req));
  } catch (e) {
    // Client may close conn abruptly before a response could be sent
    log.w("doh fail", e);
    return util.respond405();
  }
}

async function serveTcp(conn: Deno.Conn) {
  // TODO: Sync this impl with serveTcp in server-node.js
  const qlBuf = new Uint8Array(2);

  while (true) {
    let n = null;

    try {
      n = await conn.read(qlBuf);
    } catch (e) {
      log.w("err tcp query read", e);
      break;
    }

    if (n == 0 || n == null) {
      log.d("tcp socket clean shutdown");
      break;
    }

    // TODO: use dnsutil.validateSize instead
    if (n < 2) {
      log.w("query too small");
      break;
    }

    const ql = new DataView(qlBuf.buffer).getUint16(0);
    log.d(`Read ${n} octets; q len = ${qlBuf} = ${ql}`);

    const q = new Uint8Array(ql);
    n = await conn.read(q);
    log.d(`Read ${n} length q`);

    if (n != ql) {
      log.w(`query len mismatch: ${n} < ${ql}`);
      break;
    }

    // TODO: Parallel processing
    await handleTCPQuery(q, conn);
  }

  // TODO: expect client to close the connection; timeouts.
  conn.close();
}

async function handleTCPQuery(q: Uint8Array, conn: Deno.Conn) {
  try {
    const r = await resolveQuery(q);
    const rlBuf = bufutil.encodeUint8ArrayBE(r.byteLength, 2);

    const n = await conn.write(new Uint8Array([...rlBuf, ...r]));
    if (n != r.byteLength + 2) {
      log.e(`res write incomplete: ${n} < ${r.byteLength + 2}`);
    }
  } catch (e) {
    log.w("err tcp query resolve", e);
  }
}

async function resolveQuery(q: Uint8Array) {
  // TODO: Sync code with server-node.js:resolveQuery
  const freq: Request = new Request("https://ignored.example.com", {
    method: "POST",
    headers: util.concatHeaders(util.dnsHeaders(), util.contentLengthHeader(q)),
    body: q,
  });

  const r = await handleRequest(util.mkFetchEvent(freq));

  const ans = await r.arrayBuffer();

  if (!bufutil.emptyBuf(ans)) {
    return new Uint8Array(ans);
  } else {
    return new Uint8Array(dnsutil.servfailQ(q));
  }
}
