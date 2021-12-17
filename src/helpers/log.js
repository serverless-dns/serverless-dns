/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

export function setLogLevel(level) {
  level = level.toLowerCase().trim();
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
    console.log("Global Log level set to :", level);
    globalThis.logLevel = level;
  }
  return level;
}

export function e() {
  console.error(...arguments);
}

export function w() {
  console.warn(...arguments);
}

export function i() {
  console.info(...arguments);
}

export function g() {
  console.log(...arguments);
}

export function d() {
  console.debug(...arguments);
}

export function laptime() {
  console.timeLog(...arguments);
}

export function starttime(name) {
  name += id();
  console.time(name);
  return name;
}

export function endtime(name) {
  console.timeEnd(name);
}

// stackoverflow.com/a/8084248
function id() {
  // ex: ".ww8ja208it"
  return (Math.random() + 1).toString(36).slice(1);
}
