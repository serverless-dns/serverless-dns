/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import * as util from "./helpers/util.js";

// once emitted, they stick; firing off new listeners forever, just the once.
const stickyEvents = new Set([
  // when env setup is done
  "ready",
  // when plugin setup is done
  "go",
]);

const events = new Set();

const listeners = new Map();

(() => {
  for (const e of events) {
    listeners.set(e, new Set());
  }

  for (const se of stickyEvents) {
    listeners.set(se, new Set());
  }
})();

export function pub(event) {
  const eventCallbacks = listeners.get(event);

  if (!eventCallbacks) return;

  // listeners valid just the once for stickyEvents
  if (stickyEvents.has(event)) {
    listeners.delete(event);
  }

  // callbacks are queued async and don't block the caller
  util.microtaskBox(...eventCallbacks);
}

export function sub(event, cb) {
  const callbacks = listeners.get(event);

  if (!callbacks) {
    // if event is sticky, fire off the listener at once
    if (stickyEvents.has(event)) {
      util.microtaskBox(cb);
      return true;
    }
    return false;
  }

  callbacks.add(cb);

  return true;
}
