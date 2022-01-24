// env config at top, so if .env file variables are used, it is available to
// other modules.
import "./core/deno/config.ts";
import { handleRequest } from "./core/doh.js";
import * as system from "./system.js";
import { encodeUint8ArrayBE } from "./commons/bufutil.js";
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
  const { TERMINATE_TLS, TLS_CRT_PATH, TLS_KEY_PATH } = Deno.env.toObject();

  const DOH_PORT = 8080;
  const DOT_PORT = 10000;

  const tlsOpts = {
    certFile: TLS_CRT_PATH,
    keyFile: TLS_KEY_PATH,
  };
  // deno.land/manual/runtime/http_server_apis#http2-support
  const httpOpts = {
    alpnProtocols: ["h2", "http/1.1"],
  };

  const onDenoDeploy = envutil.onDenoDeploy() as Boolean;

  log = util.logger("Deno");
  if (!log) throw new Error("logger unavailable on system up");

  startDoh();

  startDotIfPossible();

  async function startDoh() {
    const doh =
      TERMINATE_TLS === "true"
        ? // doc.deno.land/deno/stable/~/Deno.listenTls
          Deno.listenTls({
            port: DOH_PORT,
            // obj spread (es2018) works only within objs
            ...tlsOpts,
            ...httpOpts,
          })
        : // doc.deno.land/deno/stable/~/Deno.listen
          Deno.listen({
            port: DOH_PORT,
          });

    up("DoH", doh.addr as Deno.NetAddr);

    // Connections to the listener will be yielded up as an async iterable.
    for await (const conn of doh) {
      log.d("DoH conn:", conn.remoteAddr);

      // To not be blocking, handle each connection without awaiting
      serveHttp(conn);
    }
  }

  async function startDotIfPossible() {
    // No DoT on Deno Deploy which supports only http workloads
    if (onDenoDeploy) return;

    const dot =
      TERMINATE_TLS === "true"
        ? Deno.listenTls({
            port: DOT_PORT,
            ...tlsOpts,
          })
        : Deno.listen({
            port: DOT_PORT,
          });

    up("DoT (no blocklists)", dot.addr as Deno.NetAddr);

    // TODO: Use the newer http/server API from Deno
    for await (const conn of dot) {
      log.d("DoT conn:", conn.remoteAddr);

      // To not be blocking, handle each connection without awaiting
      serveTcp(conn);
    }
  }

  function up(server: string, addr: Deno.NetAddr) {
    log.i(server, `listening on: [${addr.hostname}]:${addr.port}`);
  }
}

async function serveHttp(conn: Deno.Conn) {
  const httpConn = Deno.serveHttp(conn);

  while (true) {
    let requestEvent = null;
    try {
      requestEvent = await httpConn.nextRequest();
    } catch (e) {
      log.w("err http read", e);
    }
    if (!requestEvent) {
      log.d("no more reqs, bail");
      break;
    }

    try {
      // doc.deno.land/deno/stable/~/Deno.RequestEvent
      // deno.land/manual/runtime/http_server_apis#http-requests-and-responses
      const req = requestEvent.request;
      const rw = requestEvent.respondWith.bind(requestEvent);

      const res = handleRequest(mkFetchEvent(req, rw));

      // TODO: is await required: may prevent concurrent processing of reqs?
      await requestEvent.respondWith(res as Response | Promise<Response>);
    } catch (e) {
      // Client may close conn abruptly before a response could be sent
      log.w("send fail doh response", e);
    }
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
    const rlBuf = encodeUint8ArrayBE(r.byteLength, 2);

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
    const servfail = dnsutil.servfailQ(bufutil.bufferOf(q));
    return bufutil.arrayBufferOf(servfail);
  }
}

function mkFetchEvent(r: Request, ...fns: Function[]) {
  // just like with URL objs, util.emptyObj does not work for Request
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
