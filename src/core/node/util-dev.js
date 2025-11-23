/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/* For development environment use only */

import * as fs from "node:fs";

/**
 * @param {String} TLS_KEY_PATH
 * @param {String} TLS_CRT_PATH
 * @return {[BufferSource?, BufferSource?]} [TLS_KEY, TLS_CRT]
 */
export function getTLSfromFile(keyPath, crtPath) {
  return [fs.readFileSync(keyPath), fs.readFileSync(crtPath)];
}
