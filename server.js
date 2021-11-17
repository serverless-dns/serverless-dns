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
  if (!socket.servername) {
    socket.destroy();
    return;
  }

  // console.debug("-> TLS @", socket.servername);
  let qlBuf = Buffer.allocUnsafe(2).fill(0);
  let qlBufPtr = 0;

  socket.on("data", /** @param {ArrayBuffer} chunk */ (chunk) => {
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

    const q = qlBuf.readUInt16BE() ? chunk : chunk.slice(2, ql + 2);
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
 * Services a DNS over HTTPS connection
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 */
async function serveHTTPS(req, res) {
  const buffers = [];
  for await (const chunk of req) {
    buffers.push(chunk);
  }
  const q = Buffer.concat(buffers);

  // console.debug("-> HTTPS req");
  handleHTTPRequest(q, req, res);
}

/**
 * @param {Buffer} q
 * @param {tls.TLSSocket} socket
 */
async function handleTCPQuery(q, socket) {
  try {
    const r = await resolveQuery(q, socket.servername);
    const rlBuf = encodeUint8ArrayBE(r.byteLength, 2);
    if (!socket.destroyed) {
      const wrote = socket.write(new Uint8Array([...rlBuf, ...r]));
      if (!wrote) console.error(`res write incomplete: < ${r.byteLength + 2}`);
    }
  } catch (e) {
    console.warn(e);
    if (!socket.destroyed) socket.write((new Uint8Array(2)).fill(0));
  }
}

/**
 * @param {Buffer} q
 * @param {String} sni
 * @returns
 */
async function resolveQuery(q, sni) {
  const [flag, host] = sni.split(".").length < 4
    ? ["", sni]
    : [sni.split(".", 1)[0], sni.slice(sni.indexOf(".") + 1)];

  const response = await handleRequest({
    request: new Request(`https://${host}/${flag}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/dns-message",
        "content-length": q.byteLength.toString(),
      },
      body: q,
    }),
  });

  return new Uint8Array(await response.arrayBuffer());
}

/**
 * @param {Buffer} q - Request body
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 */
async function handleHTTPRequest(q, req, res) {
  const fRequest = new Request(
    new URL(req.url, `https://${req.headers.host}`),
    {
      ...req,
      body: req.method.toUpperCase() == "POST" ? q : null,
    },
  );

  const r = await handleRequest({ request: fRequest });

  res.writeHead(r.status, r.statusText, r.headers);
  res.end(Buffer.from(await r.arrayBuffer()));
}
