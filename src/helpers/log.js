/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

let debug = false;
let timer = debug || false;
let gen = debug || true;
let info = gen || true;
let warn = info || true;
let err = warn || true;

export function level(s) {
    s = s.toLowerCase().trim();
    debug = (s === "debug");
    timer = debug || (s === "timer");
    gen = debug || (s === "gen");
    info = gen || (s === "info");
    warn = info || (s === "warn");
    err = warn || (s === "error");
}

export function e() {
    if (err) console.error(...arguments);
}

export function w() {
    if (warn) console.warn(...arguments);
}

export function i() {
    if (info) console.info(...arguments);
}

export function g() {
    if (gen) console.log(...arguments);
}

export function d() {
    if (debug) console.debug(...arguments);
}

export function laptime() {
    if (timer) console.timeLog(...arguments);
}

export function starttime(name) {
    if (timer) {
      name += id();
      console.time(name);
    }
    return name;
}

export function endtime(name) {
    if (timer) console.timeEnd(name);
}

// stackoverflow.com/a/8084248
function id() {
  // ex: ".ww8ja208it"
  return (Math.random() + 1).toString(36).slice(1)
}

