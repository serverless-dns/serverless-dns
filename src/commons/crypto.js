/*
 * Copyright (c) 2022 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { createHash } from "crypto";
import { normalize8 } from "./bufutil.js";

export function md5(b) {
  return createHash("md5").update(normalize8(b)).digest("hex");
}
