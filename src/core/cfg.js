/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
/* eslint-disabled */
// eslint, no import-assert: github.com/eslint/eslint/discussions/15305
import basicconfig from "../basicconfig.json" assert { type: 'json' };

export function timestamp() {
    return basicconfig.timestamp;
}

export function tdNodeCount() {
    return basicconfig.nodecount;
}
  
export function tdParts() {
  return basicconfig.tdparts;
}

export function tdCodec6() {
  return basicconfig.useCodec6;
}
  
export function orig() {
  return basicconfig;
}

