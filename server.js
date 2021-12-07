/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { TLS_CRT, TLS_KEY } from "./helpers/node/config.js";
import { isIPv6 } from "net";
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
const dnsHeaderSize = 2;
let DNS_RG_RE = null;
let DNS_WC_RE = null;

const tServer = tls
  .createServer(tlsOptions, serveTLS)
  .listen(TLS_PORT, () => up(tServer.address()));

const hServer = https
  .createServer(tlsOptions, serveHTTPS)
  .listen(HTTPS_PORT, () => up(hServer.address()));

function up(addr) {
  console.log(`listening on: [${addr.address}]:${addr.port}`);
}

function recycleBuffer(b) {
  b.fill(0);
  return 0;
}

function createBuffer(size) {
  return Buffer.allocUnsafe(size);
}

/**
 * Services a DNS over TLS connection
 * @param {tls.TLSSocket} socket
 */
function serveTLS(socket) {
  if (!DNS_RG_RE || !DNS_WC_RE) {
    const TLS_SUBJECT_ALT = socket.getCertificate().subjectaltname;
    const DNS_RE_ARR = TLS_SUBJECT_ALT.split(",").reduce(
      (a, d) => {
        d = d.trim();
        if (d.startsWith("DNS:")) {
          d = d.replace(/^DNS:/, "");

          let re = d.replace(/\./g, "\\.");

          if (d.startsWith("*")) {
            re = re.replace("*", "[a-z0-9-_]*");
            a[1].push("(^" + re + "$)");
          } else {
            a[0].push("(^" + re + "$)");
          }
        }

        return a;
      },
      [[], []]
    );

    DNS_RG_RE = new RegExp(DNS_RE_ARR[0].join("|"), "i");
    DNS_WC_RE = new RegExp(DNS_RE_ARR[1].join("|"), "i");
    console.debug(DNS_RG_RE, DNS_WC_RE);
  }

  const SNI = socket.servername;
  const isOurWcDn = DNS_WC_RE.test(SNI);
  const isOurRgDn = DNS_RG_RE.test(SNI);
  if (!SNI || !(isOurRgDn || isOurWcDn)) {
    socket.destroy();
    return;
  }

  // NOTE: b32 flag uses delimiter `+` internally, instead of `-`.
  const [flag, host] = isOurWcDn
    ? [SNI.split(".")[0].replace(/-/g, "+"), SNI.slice(SNI.indexOf(".") + 1)]
    : ["", SNI];

  let qlenBuf = createBuffer(dnsHeaderSize);
  let qlenBufOffset = recycleBuffer(qlenBuf);
  let qBuf = null;
  let qBufOffset = 0;

  /**
   * @param {Buffer} chunk - A TCP data segment
   */
  function handleData(chunk) {
    const cl = chunk.byteLength;
    if (cl <= 0) return;

    // read header first which contains length(dns-query)
    const rem = dnsHeaderSize - qlenBufOffset;
    if (rem > 0) {
      const seek = Math.min(rem, cl);
      const read = chunk.slice(0, seek);
      qlenBuf.fill(read, qlenBufOffset);
      qlenBufOffset += seek;
    }

    // header has not been read fully, yet
    if (qlenBufOffset !== dnsHeaderSize) return;

    const qlen = qlenBuf.readUInt16BE();
    if (qlen < minDNSPacketSize || qlen > maxDNSPacketSize) {
      console.warn(`dns query out of range: ql:${qlen} cl:${cl} seek:${seek} rem:${rem}`);
      socket.destroy();
      return;
    }

    // rem bytes already read, is any more left in chunk?
    const size = cl - rem;
    if (size <= 0) return;

    // hopefully fast github.com/nodejs/node/issues/20130#issuecomment-382417255
    // chunk out dns-query starting rem-th byte
    const data = chunk.slice(rem);

    if (qBuf === null) {
      qBuf = createBuffer(qlen);
      qBufOffset = recycleBuffer(qBuf);
    }

    qBuf.fill(data, qBufOffset);
    qBufOffset += size;

    // exactly qlen bytes read till now, handle the dns query
    if (qBufOffset === qlen) {
      handleTCPQuery(qBuf, socket, host, flag);
      // reset qBuf and qlenBuf states
      qlenBufOffset = recycleBuffer(qlenBuf);
      qBuf = null;
      qBufOffset = 0;
    } else if (qBufOffset > qlen) {
      console.warn(`size mismatch: ${chunk.byteLength} <> ${qlen}`);
      socket.destroy();
      return;
    } // continue reading from socket
  }

  socket.on("data", handleData);

  socket.on("end", () => {
    // console.debug("TLS socket clean half shutdown");
    socket.end();
  });
}

/**
 * @param {Buffer} q
 * @param {tls.TLSSocket} socket
 * @param {String} host
 * @param {String} flag
 */
async function handleTCPQuery(q, socket, host, flag) {
  let ok = true;
  if (socket.destroyed) return;

  try {
    // const t1 = Date.now(); // debug
    const r = await resolveQuery(q, host, flag);
    const rlBuf = encodeUint8ArrayBE(r.byteLength, 2);
    const chunk = new Uint8Array([...rlBuf, ...r]);

    // Don't write to a closed socket, else it will crash nodejs
    if (!socket.destroyed) ok = socket.write(chunk);
    if (!ok) console.error(`res write incomplete: < ${r.byteLength + 2}`);
    // console.debug("processing time t-q =", Date.now() - t1);
  } catch (e) {
    ok = false;
    console.warn(e);
  }

  // Only close socket on error, else it would break pipelining of queries.
  if (!ok && !socket.destroyed) {
    socket.destroy();
  }
}

/**
 * @param {Buffer} q
 * @param {String} host
 * @param {String} flag
 * @returns
 */
async function resolveQuery(q, host, flag) {
  // Using POST as GET requests are capped at 2KB, where-as DNS-over-TCP
  // has a much higher ceiling (even if rarely used)
  const r = await handleRequest({
    request: new Request(`https://${host}/${flag}`, {
      method: "POST",
      headers: {
        Accept: "application/dns-message",
        "Content-Type": "application/dns-message",
        "Content-Length": q.byteLength.toString(),
      },
      body: q,
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
  const bLen = b.byteLength;

  if (
    req.method == "POST" &&
    (req.headers.accept == "application/dns-message" ||
      req.headers["content-type"] == "application/dns-message") &&
    (bLen < minDNSPacketSize || bLen > maxDNSPacketSize)
  ) {
    console.warn(`HTTP req body length out of [min, max] bounds: ${bLen}`);
    res.writeHead(413, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
    });
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
    let host = req.headers.host;
    if (isIPv6(host)) host = `[${host}]`;

    const fReq = new Request(
      new URL(req.url, `https://${host}`),
      {
        // Note: In VM container, Object spread may not be working for all
        // properties, especially of "hidden" Symbol values!? like "headers"?
        ...req,
        headers: req.headers,
        body: req.method.toUpperCase() == "POST" ? b : null,
      },
    );
    const fRes = await handleRequest({ request: fReq });

    // Don't use Object.assign or similar
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
