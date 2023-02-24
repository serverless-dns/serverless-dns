/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
import { spawnSync } from "child_process";

const swapfile = "swap__";
const swapsize = "192M";

// linuxize.com/post/create-a-linux-swap-file
export function mkswap() {
  return (
    !hasswap() &&
    sh("fallocate", ["-l", swapsize, swapfile]) &&
    sh("chmod", ["600", swapfile]) &&
    sh("mkswap", [swapfile]) &&
    sh("swapon", [swapfile]) &&
    sh("sysctl", ["vm.swappiness=30"])
  );
}

export function rmswap() {
  return hasswap() && sh("swapoff", ["-v", swapfile]) && sh("rm", [swapfile]);
}

// stackoverflow.com/a/53222213
function hasswap() {
  return sh("test", ["-e", swapfile]);
}

function sh(cmd, args) {
  if (!cmd) return false;
  args = args || [];
  const opts = {
    cwd: "/",
    uid: 0,
    shell: true,
    encoding: "utf8",
  };
  const proc = spawnSync(cmd, args, opts);
  if (proc.error) log.i(cmd, args, opts, "error", proc.error);
  if (proc.stderr) log.e(cmd, args, opts, proc.stderr);
  if (proc.stdout) log.l(proc.stdout);
  return proc.status === 0;
}
