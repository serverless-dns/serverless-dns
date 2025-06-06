/**
 * Generic utility functions, shared between all runtime.
 * Functions dependent on runtime apis of deno / node.js may not be put here,
 * but should be node.js or deno specific util files.
 *
 * @license
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
// musn't import any non-std modules

export function fromBrowser(ua) {
  if (emptyString(ua)) return false;
  return ua.startsWith("Mozilla/5.0") || ua.startsWith("dohjs/");
}

export function jsonHeaders() {
  return {
    "Content-Type": "application/json",
  };
}

export function dnsHeaders() {
  return {
    "Accept": "application/dns-message",
    "Content-Type": "application/dns-message",
  };
}

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

/**
 * @param {String} ua - User Agent string
 * @return {Object}
 */
export function corsHeadersIfNeeded(ua) {
  // allow cors when user agents claiming to be browsers
  return fromBrowser(ua) ? corsHeaders() : {};
}

export function browserHeaders() {
  return Object.assign(jsonHeaders(), corsHeaders());
}

/**
 * @param {String} ua - User Agent string
 * ex: Mozilla/5.0 (X11; U; L x86_64; rv:98.0) Gecko/101 Fx/98.0,gzip(gfe)
 * @return {Object} - Headers
 */
export function dohHeaders(ua = "Mozilla/5.0") {
  return Object.assign(dnsHeaders(), corsHeadersIfNeeded(ua));
}

export function contentLengthHeader(b) {
  const len = !b || !b.byteLength ? "0" : b.byteLength.toString();
  return { "Content-Length": len };
}

export function concatHeaders(...args) {
  return concatObj(...args);
}

export function rxidHeader(id) {
  return { "x-rethinkdns-rxid": id };
}

export function rxidFromHeader(h) {
  if (!h || !h.get) return null;
  return h.get("x-rethinkdns-rxid");
}

// developers.cloudflare.com/workers/runtime-apis/request
export function regionFromCf(req) {
  if (!req || !req.cf) return "";
  return req.cf.colo || "";
}

/**
 * returns true if tstamp is of form yyyy/epochMs
 * ex: 2025/1740866164283
 * @param {string} tstamp
 * @returns {boolean}
 */
function isValidFullTimestamp(tstamp) {
  if (typeof tstamp !== "string") return false;
  return tstamp.indexOf("/") === 4;
}

/**
 * from: github.com/celzero/downloads/blob/main/src/timestamp.js
 * @param {string} tstamp is of form epochMs ("1740866164283") or yyyy/epochMs ("2025/1740866164283")
 * @returns {int} blocklist create time (unix epoch) in millis (-1 on errors)
 */
export function bareTimestampFrom(tstamp) {
  // strip out "/" if tstamp is of form yyyy/epochMs: "2025/1740866164283"
  if (isValidFullTimestamp(tstamp)) {
    tstamp = tstamp.split("/")[1];
  }
  const t = parseInt(tstamp);
  if (isNaN(t)) {
    return -1;
  }
  return t;
}

/**
 * @param {Request} request - Request
 * @return {Object} - Headers
 */
export function copyHeaders(request) {
  const headers = {};
  if (!request || !request.headers) return headers;

  // Object.assign, Object spread, etc don't work
  request.headers.forEach((val, name) => {
    headers[name] = val;
  });
  return headers;
}

/**
 * Promise that resolves after `ms`
 * @param {number} ms - Milliseconds to sleep
 * @return {Promise}
 */
export function sleep(ms) {
  return new Promise((resolve, reject) => {
    try {
      setTimeout(resolve, ms);
    } catch (e) {
      reject(e);
    }
  });
}

export function objOf(map) {
  return map.entries ? Object.fromEntries(map) : {};
}

/**
 * @param {(function((out, err) => void))} op
 * @param {int} ms
 * @param {function(any)} cleanup
 * @returns {Promise}
 */
export function timedOp(op, ms, cleanup = (x) => {}) {
  return new Promise((resolve, reject) => {
    let timedout = false;
    const tid = timeout(ms, () => {
      timedout = true;
      reject(new Error("timeout"));
    });

    try {
      op((out, ex) => {
        if (timedout) {
          cleanup(out);
          return;
        }

        clearTimeout(tid);

        if (ex) {
          cleanup(out);
          reject(ex);
        } else {
          resolve(out);
        }
      });
    } catch (e) {
      clearTimeout(tid);
      if (!timedout) reject(e);
    }
  });
}

// TODO: Use AbortSignal.timeout (supported on Node and Deno, too)?
// developers.cloudflare.com/workers/platform/changelog#2021-12-10
/**
 *
 * @param {(...args: any[]) => Promise<*>} promisedOp
 * @param {number} ms
 * @param {(...args: any[]) => Promise<*>} defaultOp
 * @returns
 */
export function timedSafeAsyncOp(promisedOp, ms, defaultOp) {
  // aggregating promises is a valid use-case for the otherwise
  // "deferred promise anti-pattern". That is, using promise
  // constructs (async, await, catch, then etc) within a
  // "new Promise()" is an anti-pattern and hard to get right:
  // stackoverflow.com/a/23803744 and stackoverflow.com/a/25569299
  return new Promise((resolve, reject) => {
    let timedout = false;

    const deferredOp = () => {
      defaultOp()
        .then((v) => {
          resolve(v);
        })
        .catch((e) => {
          reject(e);
        });
    };
    const tid = timeout(ms, () => {
      timedout = true;
      deferredOp();
    });

    promisedOp()
      .then((out) => {
        if (!timedout) {
          clearTimeout(tid);
          resolve(out);
        }
      })
      .catch((_) => {
        clearTimeout(tid);
        if (!timedout) deferredOp();
        // else: handled by timeout
      });
  });
}

/**
 *
 * @param {number} ms
 * @param {(...args: any[]) => void} fn
 * @returns
 */
export function timeout(ms, fn) {
  if (typeof fn !== "function") return -1;
  const timer = setTimeout(fn, ms);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}

export function repeat(ms, fn) {
  if (typeof fn !== "function") return -1;

  next(fn);

  const timer = setInterval(fn, ms);
  if (typeof timer.unref === "function") timer.unref();

  return timer;
}

export function next(...fns) {
  for (const fn of fns) {
    if (typeof fn === "function") {
      if (typeof setImmediate === "function") setImmediate(fn);
      else timeout(0, fn);
    }
  }
}

// min inclusive, max exclusive
export function rand(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

export function rolldice(sides = 6) {
  return rand(1, sides + 1);
}

export function yyyymm() {
  const d = new Date();
  return d.getUTCFullYear() + "/" + (d.getUTCMonth() + 1);
}

// stackoverflow.com/a/8084248
export function uid(prefix = "") {
  // ex: ".ww8ja208it"
  return prefix + (Math.random() + 1).toString(36).slice(1);
}

export function xid() {
  const hi = vmid();
  const lo = uid();
  // ex: "m3c52dyhqz.ww8ja208it"
  return hi + lo;
}

export function uidFromXidOrRxid(id) {
  if (emptyString(id)) return "";

  const uidStartChar = id.lastIndexOf(".");
  const rxidEndChar = id.lastIndexOf("]");
  const p = uidStartChar;
  const q = rxidEndChar < 0 ? id.length : rxidEndChar;

  if (p < 0 || p >= id.length - 1 || q <= p) return "";

  return id.slice(p + 1, q);
}

// on Workers, random number can only be generated in a "network-context"
// and so, _vmid cannot be simply be instantiated as a global.
let _vmid = "0";
export function vmid() {
  if (_vmid === "0") _vmid = uid().slice(1);
  return _vmid;
}

export function isDohGetRequest(queryString) {
  return queryString && queryString.has("dns");
}

/**
 * @param {Request} req - Request
 * @return {Boolean}
 */
export function isDnsMsg(req) {
  return (
    req.headers.get("Accept") === "application/dns-message" ||
    req.headers.get("Content-Type") === "application/dns-message"
  );
}

export function mapOf(obj) {
  return new Map(Object.entries(obj));
}

export function isAlphaNumeric(str) {
  return /^[a-z0-9]+$/i.test(str);
}

export function isDNSName(str) {
  return /^[a-z0-9\.-]+$/i.test(str);
}

export function strstr(str, start = 0, end = str.length) {
  if (emptyString(str)) return str;
  if (start >= str.length) return "";
  if (end <= start) return "";

  start = start < 0 ? 0 : start;
  end = end > str.length ? str.length : end;

  return str.slice(start, end);
}

export function emptySet(s) {
  if (!s) return true;
  if (s instanceof Set) return s.size <= 0;
  return true;
}

export function emptyString(str) {
  // treat false-y values as empty
  if (!str) return true;
  // check if str is indeed a str
  if (typeof str !== "string") return false;
  // if len(str) is 0, str is empty
  return str.trim().length === 0;
}

export function emptyArray(a) {
  // treat false-y values as empty
  if (!a) return true;
  // obj v arr: stackoverflow.com/a/2462810
  if (typeof a !== "object") return false;
  if (!a.hasOwnProperty("length")) return false;
  // len(a) === 0 is empty
  return a.length <= 0;
}

export function concatObj(...args) {
  return Object.assign(...args);
}

// stackoverflow.com/a/32108184
export function emptyObj(x) {
  // note: Object.keys type-errors when x is null / undefined
  if (!x) return true;
  return (
    Object.keys(x).length === 0 && Object.getPrototypeOf(x) === Object.prototype
  );
}

export function emptyMap(m) {
  if (!m) return true;
  // does not hold good on Deno
  // if (!m.__proto__.hasOwnProperty("size")) return true;
  return m.size === 0;
}

// stackoverflow.com/a/32538867
export function isIterable(obj) {
  if (obj == null) return false;

  return typeof obj[Symbol.iterator] === "function";
}

export function respond204() {
  return new Response(null, {
    status: 204, // no content
    headers: corsHeaders(),
  });
}

export function respond400() {
  return new Response(null, {
    status: 400,
    statusText: "Bad Request",
    headers: dohHeaders(),
  });
}

export function respond401() {
  return new Response(null, {
    status: 401,
    statusText: "Authorization Required",
    headers: dohHeaders(),
  });
}

export function respond405() {
  return new Response(null, {
    status: 405,
    statusText: "Method Not Allowed",
    headers: dohHeaders(),
  });
}

export function respond408() {
  return new Response(null, {
    status: 408, // timeout
    headers: dohHeaders(),
  });
}

export function respond503() {
  return new Response(null, {
    status: 503, // unavailable
    headers: dohHeaders(),
  });
}

export function logger(...tags) {
  if (!log) return null;

  return log.withTags(...tags);
}

export function isPostRequest(req) {
  return req && !emptyString(req.method) && req.method.toUpperCase() === "POST";
}

export function isGetRequest(req) {
  return req && !emptyString(req.method) && req.method.toUpperCase() === "GET";
}

export function fromPath(strurl, re) {
  const empty = "";
  if (emptyString(strurl)) return empty;
  if (!(re instanceof RegExp)) {
    throw new Error(`invalid arg: ${re} must be RegExp`);
  }

  const u = new URL(strurl);
  // ex: x.tld/1:a/b/l:c/ => ["", "1:a", "b", "l:c", ""]
  const p = u.pathname.split("/");
  for (const x of p) {
    // returns ["1:"] if the x matches the regex
    const m = x.match(re);
    if (m != null && m.length > 0) {
      // return the string after the prefix
      return strstr(x, m[0].length);
    }
  }
  return empty;
}

export function isGatewayRequest(req) {
  if (!req || emptyString(req.url)) return false;

  const u = new URL(req.url);
  const paths = u.pathname.split("/");
  for (const p of paths) {
    if (isGatewayQuery(p)) return true;
  }
  return false;
}

export function isDnsQuery(p) {
  return p === "dns-query";
}

export function isGatewayQuery(p) {
  return p === "gateway";
}

function isNumeric4(str) {
  return /^[0-9.]+$/.test(str);
}

function isHex6(str) {
  // ipv4-in-ipv6 addrs may have . in them
  return /^[a-f0-9:.]+$/i.test(str);
}

function maybeIP6(str) {
  return !emptyString(str) && str.split(":").length > 3 && isHex6(str);
}

function maybeIP4(str) {
  return !emptyString(str) && str.split(".").length === 4 && isNumeric4(str);
}

// poorman's ip validation, don't rely for serious stuff
export function maybeIP(str) {
  return maybeIP4(str) || maybeIP6(str);
}

export function* domains(urlOrHost) {
  if (emptyString(urlOrHost)) return "";

  let hostname = urlOrHost;
  if (urlOrHost.indexOf(":") > -1 || urlOrHost.indexOf("/") > -1) {
    const u = new URL(urlOrHost);
    hostname = u.hostname;
  }

  const d = hostname.split(".");
  for (let i = 0; i < d.length; i++) {
    yield d.slice(i).join(".");
  }
}

export function tld(urlstr, upto = 2, d = ".") {
  if (emptyString(urlstr)) return "";
  // convert a domain-name of form x.y.tld to url http://x.y.tld
  if (!urlstr.includes("://")) urlstr = "http://" + urlstr;

  const u = new URL(urlstr);
  // todo: fails for domains like "gov.uk", "co.in" etc
  // see: publicsuffix.org/list/public_suffix_list.dat
  return u.hostname.split(".").slice(-upto).join(d);
}

export function bounds(n, min, max) {
  if (min > max) {
    const t = max;
    max = min;
    min = t;
  }
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export function mkFetchEvent(r, ...fns) {
  if (emptyObj(r)) throw new Error("missing request");
  for (const f of fns) {
    if (f != null && typeof f !== "function") throw new Error("args mismatch");
  }
  // developer.mozilla.org/en-US/docs/Web/API/FetchEvent
  // developers.cloudflare.com/workers/runtime-apis/fetch-event
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

export function stub(...args) {
  return (...args) => {
    /* no-op */
  };
}

export function stubAsync(...args) {
  return async (...args) => {
    /* no-op */
  };
}
