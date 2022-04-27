/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// musn't import /depend on anything.

export function onFly() {
  if (!envManager) return false;

  return envManager.get("CLOUD_PLATFORM") === "fly";
}

export function onDenoDeploy() {
  if (!envManager) return false;

  return envManager.get("CLOUD_PLATFORM") === "deno-deploy";
}

export function onCloudflare() {
  if (!envManager) return false;

  // wrangler imitates Workers runtime environment to a tee, and so
  // checks like the one proposed here archive.is/Izftu do not work
  return envManager.get("CLOUD_PLATFORM") === "cloudflare";
}

export function onLocal() {
  if (!envManager) return false;

  return !onFly() && !onDenoDeploy() && !onCloudflare();
}

export function hasDisk() {
  // got disk on fly and local deploys
  return onFly() || onLocal();
}

export function hasDynamicImports() {
  if (onDenoDeploy() || onCloudflare()) return false;
  return true;
}

export function hasHttpCache() {
  return isWorkers();
}

export function isWorkers() {
  if (!envManager) return false;

  return envManager.get("RUNTIME") === "worker";
}

export function isNode() {
  if (!envManager) return false;

  return envManager.get("RUNTIME") === "node";
}

export function isDeno() {
  if (!envManager) return false;

  return envManager.get("RUNTIME") === "deno";
}

export function workersTimeout(missing = 0) {
  if (!envManager) return missing;
  return envManager.get("WORKER_TIMEOUT") || missing;
}

export function downloadTimeout(missing = 0) {
  if (!envManager) return missing;
  return envManager.get("CF_BLOCKLIST_DOWNLOAD_TIMEOUT") || missing;
}

export function blocklistUrl() {
  if (!envManager) return null;
  return envManager.get("CF_BLOCKLIST_URL");
}

export function timestamp() {
  if (!envManager) return null;
  return envManager.get("CF_LATEST_BLOCKLIST_TIMESTAMP");
}

export function tdNodeCount() {
  if (!envManager) return null;
  return envManager.get("TD_NODE_COUNT");
}

export function tdParts() {
  if (!envManager) return null;
  return envManager.get("TD_PARTS");
}

export function primaryDohResolver() {
  if (!envManager) return null;

  return envManager.get("CF_DNS_RESOLVER_URL");
}

export function secondaryDohResolver() {
  if (!envManager) return null;

  return envManager.get("CF_DNS_RESOLVER_URL_2");
}

export function dohResolvers() {
  if (!envManager) return null;

  if (isWorkers()) {
    // upstream to two resolvers on workers; since egress is free,
    // faster among the 2 should help lower tail latencies at zero-cost
    return [primaryDohResolver(), secondaryDohResolver()];
  }

  return [primaryDohResolver()];
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
  return envManager.get("TLS_CRT") || "";
}

export function tlsKey() {
  if (!envManager) return "";
  return envManager.get("TLS_KEY") || "";
}

export function cacheTtl() {
  if (!envManager) return 0;
  return envManager.get("CACHE_TTL");
}

export function isDotOverProxyProto() {
  if (!envManager) return false;

  return envManager.get("DOT_HAS_PROXY_PROTO") || false;
}

export function isCleartext() {
  if (!envManager) return false;

  // when connecting to <appname>.fly.dev domains, fly.io edge handles tls;
  // and so, conns from fly.io edge to app is in cleartext
  return envManager.get("TLS_OFFLOAD") || false;
}

// Ports which the services are exposed on. Corresponds to fly.toml ports.
export function dohBackendPort() {
  return 8080;
}

export function dohCleartextBackendPort() {
  return isCleartext() ? 8055 : /* random*/ 0;
}

export function dotBackendPort() {
  return isDotOverProxyProto() ? 10001 : 10000;
}

export function dotProxyProtoBackendPort() {
  return isDotOverProxyProto() ? 10000 : /* random*/ 0;
}

export function dotCleartextBackendPort() {
  return isCleartext() ? 10555 : /* random*/ 0;
}

export function profileDnsResolves() {
  if (!envManager) return false;

  return envManager.get("PROFILE_DNS_RESOLVES") || false;
}

export function forceDoh() {
  if (!envManager) return true;

  // on other runtimes, continue using doh
  if (!isNode()) return true;

  // on node, default to using plain old dns
  return envManager.get("NODE_DOH_ONLY") || false;
}

export function avoidFetch() {
  if (!envManager) return false;

  // on other runtimes, continue using fetch
  if (!isNode()) return false;

  // on node, default to avoiding fetch
  return envManager.get("NODE_AVOID_FETCH") || true;
}

export function disableDnsCache() {
  // disable when profiling dns resolutions
  return profileDnsResolves();
}

export function disableBlocklists() {
  if (!envManager) return false;

  return envManager.get("DISABLE_BLOCKLISTS") || false;
}

export function gwip4() {
  return envManager.get("GW_IP4") || "";
}

export function gwip6() {
  return envManager.get("GW_IP6") || "";
}
