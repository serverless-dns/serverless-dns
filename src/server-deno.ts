// env config at top, so if .env file variables are used, it is available to
// other modules.
import "./core/deno/config.ts";
import { handleRequest } from "./core/doh.js";
import * as system from "./system.js";
import { encodeUint8ArrayBE } from "./commons/bufutil.js";
import * as util from "./commons/util.js";

let log: any = null;

((main) => {
  system.sub("go", systemUp);
})();

function systemUp() {
  const { TERMINATE_TLS, TLS_CRT_PATH, TLS_KEY_PATH } = Deno.env.toObject();
  const DOH_PORT = 8080;
  const DOT_PORT = 10000;
  const tlsOptions = {
    certFile: TLS_CRT_PATH,
    keyFile: TLS_KEY_PATH,
  };

  log = util.logger("Deno");
  if (!log) throw new Error("logger unavailable on system up");

  const doh =
    TERMINATE_TLS === "true"
      ? Deno.listenTls({
          port: DOH_PORT,
          ...tlsOptions,
        })
      : Deno.listen({
          port: DOH_PORT,
        });

  up("DoH", doh.addr as Deno.NetAddr);

  const dot =
    TERMINATE_TLS === "true"
      ? Deno.listenTls({
          port: DOT_PORT,
          ...tlsOptions,
        })
      : Deno.listen({
          port: DOT_PORT,
        });

  up("DoT (no blocking)", dot.addr as Deno.NetAddr);

  function up(server: string, addr: Deno.NetAddr) {
    log.i(server, `listening on: [${addr.hostname}]:${addr.port}`);
  }

  (async () => {
    // Connections to the listener will be yielded up as an async iterable.
    for await (const conn of doh) {
      log.d("DoH conn:", conn.remoteAddr);

      // To not be blocking, handle each connection without awaiting
      serveHttp(conn);
    }
  })();

  (async () => {
    for await (const conn of dot) {
      log.d("DoT conn:", conn.remoteAddr);

      // To not be blocking, handle each connection without awaiting
      serveTcp(conn);
    }
  })();
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
    if (requestEvent) {
      try {
        await requestEvent.respondWith(
          handleRequest(requestEvent) as Response | Promise<Response>
        );
      } catch (e) {
        // Client may close the connection abruptly before response is sent
        log.w("error handling http request", e);
      }
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
    await resolveQuery(q, conn);
  }

  // TODO: expect client to close the connection; timeouts.
  conn.close();
}

async function resolveQuery(q: Uint8Array, conn: Deno.Conn) {
  // Request Handler currently expects a FetchEvent containing request
  const response: Response = (await handleRequest({
    request: new Request("https://example.com", {
      method: "POST",
      headers: {
        "Content-Type": "application/dns-message",
        "content-length": q.byteLength.toString(),
      },
      body: q,
    }),
  })) as Response;

  const r = new Uint8Array(await response.arrayBuffer());
  const rlBuf = encodeUint8ArrayBE(r.byteLength, 2);

  const n = await conn.write(new Uint8Array([...rlBuf, ...r]));
  if (n != r.byteLength + 2) {
    log.e(`res write incomplete: ${n} < ${r.byteLength + 2}`);
  }
}
