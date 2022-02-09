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
import { serve, serveTls } from "https://deno.land/std@0.123.0/http/server.ts";
import * as system from "./system.js";
import * as util from "./commons/util.js";
import * as bufutil from "./commons/bufutil.js";
import * as dnsutil from "./commons/dnsutil.js";
import * as envutil from "./commons/envutil.js";

let log: any = null;

((main) => {
  system.sub("go", systemUp);
  // ask prepare phase to commence
  system.pub("prepare");
})();

function systemUp() {
  const onDenoDeploy = envutil.onDenoDeploy() as boolean;
  const dohConnOpts = { port: envutil.dohBackendPort() };
  const dotConnOpts = { port: envutil.dotBackendPort() };
  const tlsOpts = {
    certFile: envutil.tlsCrtPath() as string,
    keyFile: envutil.tlsKeyPath() as string,
  };
  // deno.land/manual@v1.18.0/runtime/http_server_apis_low_level
  const httpOpts = {
    alpnProtocols: ["h2", "http/1.1"],
  };

  log = util.logger("Deno");
  if (!log) throw new Error("logger unavailable on system up");

  startDoh();

  startDotIfPossible();

  async function startDoh() {
    if (terminateTls()) {
      serveTls(serveDoh, {
        ...dohConnOpts,
        ...tlsOpts,
        ...httpOpts,
      });
    } else {
      serve(serveDoh, { ...dohConnOpts });
    }

    up("DoH", dohConnOpts);
  }

  async function startDotIfPossible() {
    // No DoT on Deno Deploy which supports only http workloads
    if (onDenoDeploy) return;

    // doc.deno.land/deno/stable/~/Deno.listenTls
    // doc.deno.land/deno/stable/~/Deno.listen
    const dot = terminateTls()
      ? Deno.listenTls({ ...dotConnOpts, ...tlsOpts })
      : Deno.listen({ ...dotConnOpts });

    up("DoT (no blocklists)", dotConnOpts);

    // deno.land/manual@v1.11.3/runtime/http_server_apis#handling-connections
    for await (const conn of dot) {
      log.d("DoT conn:", conn.remoteAddr);

      // to not block the server and accept further conns, do not await
      serveTcp(conn);
    }
  }

  function up(p: string, opts: any) {
    log.i("up", p, opts, "tls?", terminateTls());
  }

  function terminateTls() {
    if (onDenoDeploy) return false;
    if (util.emptyString(tlsOpts.keyFile)) return false;
    if (util.emptyString(tlsOpts.certFile)) return false;
    return true;
  }
}

async function serveDoh(req: Request) {
  try {
    // doc.deno.land/deno/stable/~/Deno.RequestEvent
    // deno.land/manual/runtime/http_server_apis#http-requests-and-responses
    return handleRequest(mkFetchEvent(req));
  } catch (e) {
    // Client may close conn abruptly before a response could be sent
    log.w("doh fail", e);
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

  const r: Response = (await handleRequest(mkFetchEvent(freq))) as Response;

  const ans: ArrayBuffer = await r.arrayBuffer();

  if (!bufutil.emptyBuf(ans)) {
    return new Uint8Array(ans);
  } else {
    return new Uint8Array(dnsutil.servfailQ(q));
  }
}

function mkFetchEvent(r: Request, ...fns: Function[]) {
  if (!r) throw new Error("missing request");

  // deno.land/manual/runtime/http_server_apis#http-requests-and-responses
  // a service-worker event, with properties: type and request; and methods:
  // respondWith(Response), waitUntil(Promise), passThroughOnException(void)
  return {
    type: "fetch",
    request: r,
    respondWith: fns[0] || stub("event.respondWith"),
    waitUntil: fns[1] || stub("event.waitUntil"),
    passThroughOnException: fns[2] || stub("event.passThroughOnException"),
  };
}

function stub(fid: String) {
  return (...rest: any) => log.d(fid, "stub fn, args:", ...rest);
}
