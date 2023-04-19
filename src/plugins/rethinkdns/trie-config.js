/*
 * Copyright (c) 2022 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// github.com/serverless-dns/trie/blob/49049a87/src/config.js#L22
const defaults = {
  // inspect trie building stats
  inspect: false,
  // debug prints debug logs
  debug: false,
  // use codec-type b6 to convert js-str to bytes and vice-versa
  useCodec6: false,
  // optimize storing flags, that is, store less than 3 flags as-is
  optflags: false,
};

export function withDefaults(cfg) {
  const base = Object.assign({}, defaults);
  return Object.assign(base, cfg);
}
