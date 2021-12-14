/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

const err = true;
const warn = err || true;
const info = warn || true;
const gen = info || true;
const debug = g || false;
const timer = debug || false;

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

export function laptime(name) {
    if (timer) console.timeLog(name);
}

export function starttime(name) {
    if (timer) console.time(name);
}

export function endtime(name) {
    if (timer) console.timeEnd(name);
}

