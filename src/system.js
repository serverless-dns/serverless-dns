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

const events = new Set([
  // when server should cease
  "stop",
]);

const listeners = new Map();
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

// fires an event
export function pub(event, parcel = undefined) {
  awaiters(event, parcel);
  callbacks(event, parcel);
}

// invokes cb when event is fired
export function sub(event, cb) {
  const eventCallbacks = listeners.get(event);

  // if such even callbacks don't exist
  if (!eventCallbacks) {
    // but event is sticky, fire off the listener at once
    if (stickyEvents.has(event)) {
      microtaskBox(cb);
      return true;
    }
    // but event doesn't exist, then there's nothing to do
    return false;
  }

  eventCallbacks.add(cb);

  return true;
}

// waits till event fires or timesout
export function when(event, timeout = 0) {
  const wg = waitGroup.get(event);

  if (!wg) {
    // if stick event, fulfill promise right away
    if (stickyEvents.has(event)) {
      return Promise.resolve(event);
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
    const fulfiller = function (parcel) {
      if (tid >= 0) clearTimeout(tid);
      accept(parcel, event);
    };
    wg.add(fulfiller);
  });
}

function awaiters(event, parcel) {
  const g = waitGroup.get(event);

  if (!g) return;

  // listeners valid just the once for stickyEvents
  if (stickyEvents.has(event)) {
    waitGroup.delete(event);
  }

  safeBox(g, parcel);
}

function callbacks(event, parcel) {
  const cbs = listeners.get(event);

  if (!cbs) return;

  // listeners valid just the once for stickyEvents
  if (stickyEvents.has(event)) {
    listeners.delete(event);
  }

  // callbacks are queued async and don't block the caller. On Workers,
  // where IOs or timers require event-context aka network-context,
  // which is only available when fns are invoked in response to an
  // incoming request (through the fetch event handler), such callbacks
  // may not even fire. Instead use: awaiters and not callbacks.
  microtaskBox(cbs, parcel);
}

// TODO: could be replaced with scheduler.wait
// developers.cloudflare.com/workers/platform/changelog#2021-12-10
// queues fn in a macro-task queue of the event-loop
// exec order: github.com/nodejs/node/issues/22257
export function taskBox(fn) {
  util.timeout(/* with 0ms delay*/ 0, () => safeBox(fn));
}

// queues fn in a micro-task queue
// ref: MDN: Web/API/HTML_DOM_API/Microtask_guide/In_depth
// queue-task polyfill: stackoverflow.com/a/61605098
const taskboxPromise = { p: Promise.resolve() };
function microtaskBox(fns, arg) {
  let enqueue = null;
  if (typeof queueMicrotask === "function") {
    enqueue = queueMicrotask;
  } else {
    enqueue = taskboxPromise.p.then.bind(taskboxPromise.p);
  }

  enqueue(() => safeBox(fns, arg));
}

// TODO: safeBox for async fns with r.push(await f())?
// stackoverflow.com/questions/38508420
function safeBox(fns, arg) {
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
