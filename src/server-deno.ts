// env config at top, so if .env file variables are used, it is available to
// other modules.
import "./core/deno/config.ts";
import { handleRequest } from "./core/doh.js";
import * as system from "./system.js";
import { encodeUint8ArrayBE } from "./commons/bufutil.js";
import * as util from "./commons/util.js";
import * as bufutil from "./commons/bufutil.js";
import * as dnsutil from "./commons/dnsutil.js";

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
  const onDenoDeploy = Deno.env.get("CLOUD_PLATFORM") === "deno-deploy";

  log = util.logger("Deno");
  if (!log) throw new Error("logger unavailable on system up");

  startDoh();

  // Deno-Deploy only has port 443, port 80 is mapped to it.
  !onDenoDeploy && startDot();

  async function startDoh() {
    const doh =
      TERMINATE_TLS === "true"
        ? // doc.deno.land/deno/stable/~/Deno.listenTls
          Deno.listenTls({
            port: DOH_PORT,
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

  async function startDot() {
    const dot =
      TERMINATE_TLS === "true"
        ? Deno.listenTls({
            port: DOT_PORT,
            ...tlsOpts,
          })
        : Deno.listen({
            port: DOT_PORT,
          });

    up("DoT (no blocking)", dot.addr as Deno.NetAddr);

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
  let requestEvent = null;

  while (true) {
    try {
      requestEvent = await httpConn.nextRequest();
    } catch (e) {
      log.w("error reading http request", e);
    }
    if (!requestEvent) continue;
    let res = null;
    try {
      res = handleRequest(requestEvent);
    } catch (e) {
      res = util.respond405();
      log.w("serv fail doh request", e);
    }
    try {
      await requestEvent.respondWith(res as Response | Promise<Response>);
    } catch (e) {
      // Client may close the connection abruptly before response is sent
      log.w("send fail doh response", e);
    }
  }
}

async function serveTcp(conn: Deno.Conn) {
  const qlBuf = new Uint8Array(2);

  while (true) {
    let n = null;

    try {
      n = await conn.read(qlBuf);
    } catch (e) {
      log.w("error reading from tcp query socket", e);
      break;
    }

    if (n == 0 || n == null) {
      log.d("TCP socket clean shutdown");
      break;
    }

    if (n < 2) {
      log.w("incomplete query length");
      break;
    }

    const ql = new DataView(qlBuf.buffer).getUint16(0);
    log.d(`Read ${n} octets; q len = ${qlBuf} = ${ql}`);

    const q = new Uint8Array(ql);
    n = await conn.read(q);
    log.d(`Read ${n} length q`);

    if (n != ql) {
      log.w(`incomplete query: ${n} < ${ql}`);
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
    log.w("error handling tcp query", e);
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
  if (util.emptyObj(r)) throw new Error("missing request");

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
  return (...rest: any) => log.w(fid, "stub fn, args:", ...rest);
}
