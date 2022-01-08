/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as util from "./commons/util.js";

// once emitted, they stick; firing off new listeners forever, just the once.
const stickyEvents = new Set([
  // when env setup is done
  "ready",
  // when plugin setup is done
  "go",
]);

const events = new Set();

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
export function pub(event) {
  awaiters(event);
  callbacks(event);
}

// invokes cb when event is fired
export function sub(event, cb) {
  const eventCallbacks = listeners.get(event);

  if (!eventCallbacks) {
    // if event is sticky, fire off the listener at once
    if (stickyEvents.has(event)) {
      util.microtaskBox(cb);
      return true;
    }
    return false;
  }

  eventCallbacks.add(cb);

  return true;
}

// waits till event fires or timesout
export function when(event, timeout) {
  const wg = waitGroup.get(event);

  if (!wg) {
    // if stick event, fulfill promise right away
    if (stickyEvents.has(event)) {
      return Promise.resolve(event);
    }
    // no such event
    return Promise.reject(new Error(event + " missing"));
  }

  const w = waiter(timeout, event);

  wg.add(w.fulfiller);

  return w.awaiter;
}

function awaiters(event) {
  const wg = waitGroup.get(event);

  if (!wg) return;

  // listeners valid just the once for stickyEvents
  if (stickyEvents.has(event)) {
    waitGroup.delete(event);
  }

  for (const f of wg) {
    // awaiter may have timedout
    util.safeBox(f);
  }
}

function callbacks(event) {
  const eventCallbacks = listeners.get(event);

  if (!eventCallbacks) return;

  // listeners valid just the once for stickyEvents
  if (stickyEvents.has(event)) {
    listeners.delete(event);
  }

  // callbacks are queued async and don't block the caller
  util.microtaskBox(...eventCallbacks);
}

function waiter(ms, event) {
  let tid = -1;
  let accept = () => {};
  const w = new Promise((y, reject) => {
    tid = util.timeout(ms, () => {
      reject(new Error(event + " elapsed " + ms));
    });
    accept = y;
  });
  return {
    awaiter: w,
    fulfiller: function () {
      clearTimeout(tid);
      accept(event);
    },
  };
}
