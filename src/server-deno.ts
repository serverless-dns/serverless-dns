// env config at top, so if .env file variables are used, it is available to
// other modules.
import "./helpers/deno/config.ts";
import { handleRequest } from "./index.js";
import * as system from "./system.js";

((main) => {
  system.sub("go", systemUp);
})();

async function systemUp() {
  const { TERMINATE_TLS, TLS_CRT_PATH, TLS_KEY_PATH } = Deno.env.toObject();
  const HTTP_PORT = 8080;

  const l = (TERMINATE_TLS == "true")
    ? Deno.listenTls({
      port: HTTP_PORT,
      certFile: TLS_CRT_PATH,
      keyFile: TLS_KEY_PATH,
    })
    : Deno.listen({
      port: HTTP_PORT,
    });
  console.log(`deno up at: http://${(l.addr as Deno.NetAddr).hostname}:${
      (l.addr as Deno.NetAddr).port
    }/`,
  );

  // Connections to the listener will be yielded up as an async iterable.
  for await (const conn of l) {
    // To not be blocking, handle each connection without awaiting
    handleHttp(conn);
  }
}

async function handleHttp(conn: Deno.Conn) {
  const httpConn = Deno.serveHttp(conn);
  let requestEvent = null;

  while (true) {
    try {
      requestEvent = await httpConn.nextRequest();
    } catch (e) {
      console.warn("error reading http request", e);
    }
    if (requestEvent) {
      try {
        await requestEvent.respondWith(
          handleRequest(requestEvent) as Response | Promise<Response>,
        );
      } catch (e) {
        // Client may close the connection abruptly before response is sent
        console.warn("error handling http request", e);
      }
    }
  }
}
