/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as util from "./commons/util.js";

// Evaluate if EventTarget APIs can replace this hand-rolled impl
// developers.cloudflare.com/workers/platform/changelog#2021-09-24

/** @typedef {any[]?} parcel */
/** @typedef {function(parcel)} listenfn */

// once emitted, they stick; firing off new listeners forever, just the once.
const stickyEvents = new Set([
  // when process bring-up is done
  "prepare",
  // when env setup is done
  "ready",
  // when svc setup is done
  "steady",
  // when all systems are a-go
  "go",
]);

/** @type {Map<string, parcel>} */
const stickyParcels = new Map();

const events = new Set([
  // when server should cease
  "stop",
]);

/** @type {Map<string, Set<listenfn>>} */
const listeners = new Map();
/** @type {Map<string, Set<listenfn>>} */
const waitGroup = new Map();

(() => {
  for (const e of events) {
    listeners.set(e, new Set());
    waitGroup.set(e, new Set());
  }

  for (const se of stickyEvents) {
    listeners.set(se, new Set());
    waitGroup.set(se, new Set());
  }
})();

/**
 * Fires event.
 * @param {string} event
 * @param {parcel} parcel
 */
export function pub(event, parcel = undefined) {
  awaiters(event, parcel);
  callbacks(event, parcel);
}

/**
 * Invokes cb when event is fired.
 * @param {string} event
 * @param {listenfn} cb
 * @param {int} timeout
 * @returns {boolean}
 */
export function sub(event, cb, timeout = 0) {
  const eventCallbacks = listeners.get(event);

  // if such even callbacks don't exist
  if (!eventCallbacks) {
    // but event is sticky, fire off the listener at once
    if (stickyEvents.has(event)) {
      const parcel = stickyParcels.get(event); // may be null
      microtaskBox(cb, parcel);
      return true;
    }
    // but event doesn't exist, then there's nothing to do
    return false;
  }

  const tid = timeout > 0 ? util.timeout(timeout, cb) : -2;
  const fulfiller =
    tid > 0
      ? (parcel) => {
          clearTimeout(tid);
          cb(parcel);
        }
      : cb;

  eventCallbacks.add(fulfiller);
  return true;
}

/**
 * Waits till event fires or timesout.
 * @param {string} event
 * @param {int} timeout
 * @returns {Promise<parcel>}
 */
export function when(event, timeout = 0) {
  const wg = waitGroup.get(event);

  if (!wg) {
    // if stick event, fulfill promise right away
    if (stickyEvents.has(event)) {
      const parcel = stickyParcels.get(event); // may be null
      return Promise.resolve(parcel);
    }
    // no such event
    return Promise.reject(new Error(event + " missing"));
  }

  return new Promise((accept, reject) => {
    const tid =
      timeout > 0
        ? util.timeout(timeout, () => {
            reject(new Error(event + " elapsed " + timeout));
          })
        : -2;
    /** @type {listenfn} */
    const fulfiller = (parcel) => {
      if (tid >= 0) clearTimeout(tid);
      accept(parcel);
    };
    wg.add(fulfiller);
  });
}

/**
 * @param {string} event
 * @param {parcel} parcel
 */
function awaiters(event, parcel = null) {
  const g = waitGroup.get(event);

  if (!g) return;

  // listeners valid just the once for stickyEvents
  if (stickyEvents.has(event)) {
    waitGroup.delete(event);
    stickyParcels.set(event, parcel);
  }

  safeBox(g, parcel);
}

/**
 * @param {string} event
 * @param {parcel} parcel
 */
function callbacks(event, parcel = null) {
  const cbs = listeners.get(event);

  if (!cbs) return;

  // listeners valid just the once for stickyEvents
  if (stickyEvents.has(event)) {
    listeners.delete(event);
    stickyParcels.set(event, parcel);
  }

  // callbacks are queued async and don't block the caller. On Workers,
  // where IOs or timers require event-context aka network-context,
  // which is only available when fns are invoked in response to an
  // incoming request (through the fetch event handler), such callbacks
  // may not even fire. Instead use: awaiters and not callbacks.
  microtaskBox(cbs, parcel);
}

/**
 * Queues fn in a macro-task queue of the event-loop
 * exec order: github.com/nodejs/node/issues/22257
 * @param {listenfn} fn
 */
export function taskBox(fn) {
  // TODO: could be replaced with scheduler.wait
  // developers.cloudflare.com/workers/platform/changelog#2021-12-10
  util.timeout(/* with 0ms delay*/ 0, () => safeBox(fn));
}

// ref: MDN: Web/API/HTML_DOM_API/Microtask_guide/In_depth
// queue-task polyfill: stackoverflow.com/a/61605098
const taskboxPromise = { p: Promise.resolve() };
/**
 * Queues fns in a micro-task queue
 * @param {listenfn[]} fns
 * @param {parcel} arg
 */
function microtaskBox(fns, arg) {
  let enqueue = null;
  if (typeof queueMicrotask === "function") {
    enqueue = queueMicrotask;
  } else {
    enqueue = taskboxPromise.p.then.bind(taskboxPromise.p);
  }

  enqueue(() => safeBox(fns, arg));
}

/**
 * stackoverflow.com/questions/38508420
 * @param {listenfn[]|listenfn?} fns
 * @param {parcel} arg
 * @returns {any[]}
 */
function safeBox(fns, arg) {
  // TODO: safeBox for async fns with r.push(await f())?
  if (typeof fns === "function") {
    fns = [fns];
  }

  const r = [];
  if (!util.isIterable(fns)) {
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
