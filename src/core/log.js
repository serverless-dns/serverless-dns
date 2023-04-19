/**
 * Logging utilities.
 *
 * @license
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { uid, stub } from "../commons/util.js";

/**
 * @typedef {'error'|'logpush'|'warn'|'info'|'timer'|'debug'} LogLevels
 */

// high "error" (4); low "debug" (0);
const LEVELS = new Set(["error", "logpush", "warn", "info", "timer", "debug"]);

/**
 * Configure console level.
 * `console` methods are made non-functional accordingly.
 * May be checked with `console.level`.
 * Has no default value, to prevent accidentally nullifying console methods. So,
 * the de facto console level is 'debug`.
 * @param {LogLevels} level - log level
 * @return {LogLevels} level
 */
function _setConsoleLevel(level) {
  switch (level) {
    case "error":
    case "logpush":
      globalThis.console.warn = stub();
    case "warn":
      globalThis.console.info = stub();
    case "info":
      globalThis.console.time = stub();
      globalThis.console.timeEnd = stub();
      globalThis.console.timeLog = stub();
    case "timer":
      globalThis.console.debug = stub();
    case "debug":
      break;
    default:
      console.error("Unknown console level: ", level);
      level = null;
  }
  if (level) {
    // console.log("Console level set: ", level);
    globalThis.console.level = level;
  }
  return level;
}

export default class Log {
  /**
   * Provide console methods alias and similar meta methods.
   * Sets log level for the current instance.
   * Default='debug', so as default instance (`new Log()`) is a pure alias.
   * If console level has been set, log level cannot be lower than it.
   * @param {{
   * level: LogLevels,
   * levelize: boolean,
   * withTimestamps: boolean
   * }} - options
   */
  constructor({ level = "debug", levelize = false, withTimestamps = false }) {
    level = level.toLowerCase();
    if (!LEVELS.has(level)) level = "debug";
    // if logpush, then levlelize to stub out all but error and logpush logs
    if (level === "logpush") levelize = true;
    if (levelize && !console.level) _setConsoleLevel(level);

    this.l = console.log;
    this.log = console.log;
    this.logTimestamps = withTimestamps;

    this.setLevel(level);
  }

  _resetLevel() {
    this.d = stub();
    this.debug = stub();
    this.lapTime = stub();
    this.startTime = stub();
    this.endTime = stub();
    this.i = stub();
    this.info = stub();
    this.w = stub();
    this.warn = stub();
    this.e = stub();
    this.error = stub();
  }

  withTags(...tags) {
    const that = this;
    return {
      lapTime: (n, ...r) => {
        return that.lapTime(n, ...tags, ...r);
      },
      startTime: (n, ...r) => {
        const tid = that.startTime(n);
        that.d(that.now() + " T", ...tags, "create", tid, ...r);
        return tid;
      },
      endTime: (n, ...r) => {
        that.d(that.now() + " T", ...tags, "end", n, ...r);
        return that.endTime(n);
      },
      d: (...args) => {
        that.d(that.now() + " D", ...tags, ...args);
      },
      i: (...args) => {
        that.i(that.now() + " I", ...tags, ...args);
      },
      w: (...args) => {
        that.w(that.now() + " W", ...tags, ...args);
      },
      e: (...args) => {
        that.e(that.now() + " E", ...tags, ...args);
      },
      q: (...args) => {
        that.l(that.now() + " Q", ...tags, ...args);
      },
      qStart: (...args) => {
        that.l(that.now() + " Q", ...tags, that.border());
        that.l(that.now() + " Q", ...tags, ...args);
      },
      qEnd: (...args) => {
        that.l(that.now() + " Q", ...tags, ...args);
        that.l(that.now() + " Q", ...tags, that.border());
      },
      tag: (t) => {
        tags.push(t);
      },
    };
  }

  now() {
    if (this.logTimestamps) return new Date().toISOString();
    else return "";
  }

  border() {
    return "-------------------------------";
  }

  /**
   * Modify log level of this instance. Unlike the constructor, this has no
   * default value.
   * @param {LogLevels} level
   */
  setLevel(level) {
    level = level.toLowerCase();
    if (!LEVELS.has(level)) throw new Error(`Unknown log level: ${level}`);

    this._resetLevel();

    switch (level) {
      default:
      case "debug":
        this.d = console.debug;
        this.debug = console.debug;
      case "timer":
        this.lapTime = console.timeLog || stub(); // Stubbing required for Fastly as they do not currently support this method.
        this.startTime = function (name) {
          name = uid(name);
          if (console.time) console.time(name);
          return name;
        };
        this.endTime = console.timeEnd || stub(); // Stubbing required for Fastly as they do not currently support this method.
      case "info":
        this.i = console.info;
        this.info = console.info;
      case "warn":
        this.w = console.warn;
        this.warn = console.warn;
      case "error":
      case "logpush":
        this.e = console.error;
        this.error = console.error;
    }
    console.debug("Log level set: ", level);
    this.level = level;
  }
}
