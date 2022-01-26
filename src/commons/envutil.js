/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// musn't import /depend on anything.
export function onFly() {
  return env && env.cloudPlatform === "fly";
}

export function onDenoDeploy() {
  return env && env.cloudPlatform === "deno-deploy";
}

export function hasDisk() {
  // got disk on test nodejs envs and on fly
  return onFly() || (isNode() && !isProd());
}

export function hasHttpCache() {
  return isWorkers();
}

export function isProd() {
  return env && env.runTimeEnv === "production";
}

export function isWorkers() {
  return env && env.runTime === "worker";
}

export function isNode() {
  return env && env.runTime === "node";
}

export function workersTimeout(missing = 0) {
  return (env && env.workerTimeout) || missing;
}

export function downloadTimeout(missing = 0) {
  return (env && env.fetchTimeout) || missing;
}

export function blocklistUrl() {
  if (!env) return null;
  return env.blocklistUrl;
}

export function timestamp() {
  if (!env) return null;
  return env.latestTimestamp;
}

export function tdNodeCount() {
  if (!env) return null;
  return env.tdNodecount;
}

export function tdParts() {
  if (!env) return null;
  return env.tdParts;
}

export function dohResolver() {
  if (!env) return null;
  return env.dnsResolverUrl;
}

export function secondaryDohResolver() {
  if (!env) return null;
  return env.secondaryDohResolver;
}

export function tlsCrtPath() {
  if (!envManager) return "";
  return envManager.get("TLS_CRT_PATH") || "";
}

export function tlsKeyPath() {
  if (!envManager) return "";
  return envManager.get("TLS_KEY_PATH") || "";
}

export function tlsCrt() {
  if (!envManager) return "";
  return envManager.get("tlsCrt") || "";
}

export function tlsKey() {
  if (!envManager) return "";
  return envManager.get("tlsKey") || "";
}

export function cacheTtl() {
  if (!env) return 0;
  return env.cacheTtl;
}
