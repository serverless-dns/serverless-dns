/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import { uid } from "./util.js";

/**
 * Configure console log level globally. May be checked with `console.logLevel`.
 * `console` methods are made non-functional accordingly.
 * Call this only once.
 * @param {'error'|'warn'|'info'|'timer'|'debug'} level - log level
 * @returns
 */
export function globalConsoleLevel(level) {
  level = level.toLowerCase().trim();
  if (console.level) throw new Error("Log level already configured");
  switch (level) {
    case "error":
      globalThis.console.warn = () => null;
    case "warn":
      globalThis.console.info = () => null;
    case "info":
      globalThis.console.time = () => null;
      globalThis.console.timeEnd = () => null;
      globalThis.console.timeLog = () => null;
    case "timer":
      globalThis.console.debug = () => null;
    case "debug":
      break;
    default:
      console.error("Unknown log level", level);
      level = null;
  }
  if (level) {
    globalThis.console.level = level;
    console.log("log level:", level);
  }
  return level;
}

export default class Log {
  /**
   * Sets log level for the current instance. Defaults to `debug`.
   * @param {'error'|'warn'|'info'|'timer'|'debug'} [level] - log level
   */
  constructor(level) {
    this.logLevels = ["error", "warn", "info", "timer", "debug"];
    this.setLevel(level);
  }
  resetLevel() {
    this.l = console.log;
    this.d = () => null;
    this.lapTime = () => null;
    this.startTime = () => null;
    this.endTime = () => null;
    this.i = () => null;
    this.w = () => null;
    this.e = () => null;
  }
  setLevel(level) {
    this.resetLevel();
    switch (level) {
      default:
      case "debug":
        this.d = console.debug;
      case "timer":
        this.lapTime = console.timeLog;
        this.startTime = function (name) {
          name += uid();
          console.time(name);
          return name;
        };
        this.endTime = console.timeEnd;
      case "info":
        this.i = console.info;
      case "warn":
        this.w = console.warn;
      case "error":
        this.e = console.error;
    }
    if (this.logLevels.indexOf(level) < 0) this.logLevel = "debug";
    else this.logLevel = level;
  }
}

