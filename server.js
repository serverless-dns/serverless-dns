import { TLS_CRT, TLS_KEY } from "./helpers/node/config.js";
import * as tls from "tls";
// import { IncomingMessage, ServerResponse } from "http";
import * as https from "https";
import { handleRequest } from "./index.js";
import { encodeUint8ArrayBE } from "./helpers/util.js";

const TLS_PORT = 10000;
const HTTPS_PORT = 8080;
const tlsOptions = {
  key: TLS_KEY,
  cert: TLS_CRT,
};
const minDNSPacketSize = 12 + 5;
const maxDNSPacketSize = 4096;

const tServer = tls.createServer(tlsOptions, serveTLS).listen(
  TLS_PORT,
  () => logListner(tServer.address()),
);

const hServer = https.createServer(tlsOptions, serveHTTPS).listen(
  HTTPS_PORT,
  () => logListner(hServer.address()),
);

function logListner(addr) {
  console.log(`listening on: [${addr.address}]:${addr.port}`);
}

/**
 * Services a DNS over TLS connection
 * @param {tls.TLSSocket} socket
 */
function serveTLS(socket) {
  // TODO: Find a way to match DNS name with SNI
  if (!socket.servername || socket.servername.split(".").length < 3) {
    socket.destroy();
    return;
  }

  // console.debug("-> TLS @", socket.servername);
  let qlBuf = Buffer.allocUnsafe(2).fill(0);
  let qlBufPtr = 0;

  socket.on("data", /** @param {Buffer} chunk */ (chunk) => {
    const cl = chunk.byteLength;
    if (cl == 0) return;
    if (cl == 1) {
      qlBuf.fill(chunk, qlBufPtr);
      qlBufPtr = qlBufPtr ? 0 : 1;
      return;
    }
    if (qlBufPtr) {
      qlBuf.fill(chunk.slice(0, 1), qlBufPtr);
      qlBufPtr = 0;
      chunk = chunk.slice(1);
    }
    if (!qlBuf.readUInt16BE() && cl == 2) {
      qlBuf = chunk;
      return;
    }

    const ql = qlBuf.readUInt16BE() || chunk.slice(0, 2).readUInt16BE();
    // console.debug(`q len = ${ql}`);
    if (ql < minDNSPacketSize || ql > maxDNSPacketSize) {
      console.warn(`TCP query length out of [min, max] bounds: ${ql}`);
      socket.destroy();
      return;
    }

    const q = qlBuf.readUInt16BE() ? chunk : chunk.slice(2);
    // console.debug(`Read q:`, q);
    qlBuf.fill(0);

    if (q.byteLength != ql) {
      console.warn(`incomplete query: ${q.byteLength} < ${ql}`);
      socket.destroy();
      return;
    }

    // console.debug("-> TLS q", q.byteLength);
    handleTCPQuery(q, socket);
  });

  socket.on("end", () => {
    // console.debug("TLS socket clean half shutdown");
    socket.end();
  });
}

/**
 * @param {Buffer} q
 * @param {tls.TLSSocket} socket
 */
async function handleTCPQuery(q, socket) {
  try {
    // const t1 = Date.now(); // debug
    const r = await resolveQuery(q, socket.servername);
    const rlBuf = encodeUint8ArrayBE(r.byteLength, 2);
    if (!socket.destroyed) {
      const wrote = socket.write(new Uint8Array([...rlBuf, ...r]));
      if (!wrote) console.error(`res write incomplete: < ${r.byteLength + 2}`);
      // console.debug("processing time t-q =", Date.now() - t1);
    }
  } catch (e) {
    console.warn(e);
    // Only close socket on error, else it would break pipelining of queries.
    if (!socket.destroyed) socket.destroy();
  }
}

/**
 * @param {Buffer} q
 * @param {String} sni
 * @returns
 */
async function resolveQuery(q, sni) {
  // NOTE: b32 flag uses delimiter `+` internally, instead of `-`.
  // TODO: Find a way to match DNS name with SNI to find flag.
  const [flag, host] = sni.split(".").length < 4
    ? ["", sni]
    : [sni.split(".")[0].replace(/-/g, "+"), sni.slice(sni.indexOf(".") + 1)];

  const qURL = new URL(
    `/${flag}?dns=${q.toString("base64url").replace(/=/g, "")}`,
    `https://${host}`,
  );

  const r = await handleRequest({
    request: new Request(qURL, {
      method: "GET",
      headers: {
        "Accept": "application/dns-message",
      },
    }),
  });

  return new Uint8Array(await r.arrayBuffer());
}

/**
 * Services a DNS over HTTPS connection
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 */
async function serveHTTPS(req, res) {
  const buffers = [];
  for await (const chunk of req) {
    buffers.push(chunk);
  }
  const b = Buffer.concat(buffers);
  const bl = b.byteLength;

  if (
    req.method == "POST" && (bl < minDNSPacketSize || bl > maxDNSPacketSize)
  ) {
    console.warn(`HTTP req body length out of [min, max] bounds: ${bl}`);
    res.end();
    return;
  }

  // console.debug("-> HTTPS req", req.method, bl);
  handleHTTPRequest(b, req, res);
}

/**
 * @param {Buffer} b - Request body
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 */
async function handleHTTPRequest(b, req, res) {
  try {
    // const t1 = Date.now(); // debug
    const fReq = new Request(
      new URL(req.url, `https://${req.headers.host}`),
      {
        // Note: In VM container, Object spread may not be working for all
        // properties, especially of "hidden" Symbol values!? like "headers"?
        ...req,
        headers: req.headers,
        body: req.method.toUpperCase() == "POST" ? b : null,
      },
    );
    const fRes = await handleRequest({ request: fReq });

    const resHeaders = {};
    fRes.headers.forEach((v, k) => {
      resHeaders[k] = v;
    });
    res.writeHead(fRes.status, resHeaders);
    res.end(Buffer.from(await fRes.arrayBuffer()));
    // console.debug("processing time h-q =", Date.now() - t1);
  } catch (e) {
    console.warn(e);
  } finally {
    res.end();
  }
}
