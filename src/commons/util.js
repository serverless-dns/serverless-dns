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
  return ua && ua.startsWith("Mozilla/5.0");
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
 * @return {Object} - Headers
 */
export function dohHeaders(ua) {
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

export function timedOp(op, ms, cleanup = () => {}) {
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
          reject(ex);
        } else {
          resolve(out);
        }
      });
    } catch (e) {
      if (!timedout) reject(e);
    }
  });
}

// TODO: Use AbortSignal.timeout (supported on Node and Deno, too)?
// developers.cloudflare.com/workers/platform/changelog#2021-12-10
export function timedSafeAsyncOp(promisedOp, ms, defaultOp) {
  // aggregating promises is a valid use-case for the otherwise
  // "deferred promise anti-pattern". That is, using promise
  // constructs (async, await, catch, then etc) within a
  // "new Promise()" is an anti-pattern and hard to get right:
  // stackoverflow.com/a/23803744 and stackoverflow.com/a/25569299
  return new Promise((resolve, reject) => {
    let timedout = false;

    const defferedOp = () => {
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
      defferedOp();
    });

    promisedOp()
      .then((out) => {
        if (!timedout) {
          clearTimeout(tid);
          resolve(out);
        }
      })
      .catch((ignored) => {
        if (!timedout) defferedOp();
        // else: handled by timeout
      });
  });
}

export function timeout(ms, callback) {
  if (typeof callback !== "function") return -1;
  return setTimeout(callback, ms);
}

// min inclusive, max exclusive
export function rand(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

export function rolldice(sides = 6) {
  return rand(1, sides + 1);
}

// stackoverflow.com/a/8084248
export function uid() {
  // ex: ".ww8ja208it"
  return (Math.random() + 1).toString(36).slice(1);
}

export function xid() {
  const hi = vmid();
  const lo = uid();
  return hi + lo;
}

// on Workers, random number can only be generated in a "network-context"
// and so, _vmid cannot be simply be instantiated as a global.
let _vmid = "0";
export function vmid() {
  if (_vmid === "0") _vmid = uid().slice(1);
  return _vmid;
}

// TODO: could be replaced with scheduler.wait
// developers.cloudflare.com/workers/platform/changelog#2021-12-10
// queues fn in a macro-task queue of the event-loop
// exec order: github.com/nodejs/node/issues/22257
export function taskBox(fn) {
  timeout(/* with 0ms delay*/ 0, () => safeBox(fn));
}

// queues fn in a micro-task queue
// ref: MDN: Web/API/HTML_DOM_API/Microtask_guide/In_depth
// queue-task polyfill: stackoverflow.com/a/61605098
const taskboxPromise = { p: Promise.resolve() };
export function microtaskBox(fns, arg) {
  let enqueue = null;
  if (typeof queueMicrotask === "function") {
    enqueue = queueMicrotask;
  } else {
    enqueue = taskboxPromise.p.then.bind(taskboxPromise.p);
  }

  enqueue(() => safeBox(fns, arg));
}

// TODO: safeBox for async fns with r.push(await f())?
export function safeBox(fns, arg) {
  if (typeof fns === "function") {
    fns = [fns];
  }

  const r = [];
  if (!isIterable(fns)) {
    return r;
  }

  for (const f of fns) {
    if (typeof f !== "function") {
      r.push(null);
      continue;
    }
    try {
      r.push(f(arg));
    } catch (ignore) {
      r.push(null);
    }
  }

  return r;
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

export function emptyResponse() {
  return {
    isException: false,
    exceptionStack: "",
    exceptionFrom: "",
    data: {},
  };
}

export function errResponse(id, err) {
  const st = emptyObj(err) || !err.stack ? "no-stacktrace" : err.stack;
  return {
    isException: true,
    exceptionStack: st,
    exceptionFrom: id,
    data: {},
  };
}

export function mapOf(obj) {
  return new Map(Object.entries(obj));
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
function isIterable(obj) {
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
  });
}

export function respond405() {
  return new Response(null, {
    status: 405,
    statusText: "Method Not Allowed",
  });
}

export function respond408() {
  return new Response(null, {
    status: 408, // timeout
  });
}

export function respond503() {
  return new Response(null, {
    status: 503, // unavailable
    headers: dnsHeaders(),
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

export function mkFetchEvent(r, ...fns) {
  if (emptyObj(r)) throw new Error("missing request");
  for (const f of fns) {
    if (f != null && typeof f !== "function") throw new Error("args mismatch");
  }
  // developer.mozilla.org/en-US/docs/Web/API/FetchEvent
  // developers.cloudflare.com/workers/runtime-apis/fetch-event
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
