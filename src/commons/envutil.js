/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// musn't import /depend on anything.

export function isProd() {
  if (!envManager) return false;

  return envManager.determineEnvStage() === "production";
}

export function onFly() {
  if (!envManager) return false;

  return envManager.get("CLOUD_PLATFORM") === "fly";
}

export function onDenoDeploy() {
  if (!envManager) return false;

  return envManager.get("CLOUD_PLATFORM") === "deno-deploy";
}

export function onFastly() {
  if (!envManager) return false;

  return envManager.get("CLOUD_PLATFORM") === "fastly";
}

export function onCloudflare() {
  if (!envManager) return false;

  // wrangler imitates Workers runtime environment to a tee, and so
  // checks like the one proposed here archive.is/Izftu do not work
  return envManager.get("CLOUD_PLATFORM") === "cloudflare";
}

export function onLocal() {
  if (!envManager) return false;

  return !onFly() && !onDenoDeploy() && !onCloudflare() && !onFastly();
}

export function hasDisk() {
  // got disk on fly and local deploys
  return onFly() || onLocal();
}

export function useMmap() {
  // got disk on fly and local deploys
  return (onFly() || onLocal()) && (isNode() || isBun());
}

export function hasDynamicImports() {
  if (onDenoDeploy() || onCloudflare() || onFastly()) return false;
  return true;
}

export function hasHttpCache() {
  return isWorkers();
}

export function isBun() {
  if (!envManager) return false;

  return envManager.r() === "bun";
}

export function isWorkers() {
  if (!envManager) return false;

  return envManager.r() === "worker";
}

export function isFastly() {
  if (!envManager) return false;

  return envManager.r() === "fastly";
}

export function isNode() {
  if (!envManager) return false;

  return envManager.r() === "node";
}

export function isDeno() {
  if (!envManager) return false;

  return envManager.r() === "deno";
}

/**
 * in milliseconds
 */
export function workersTimeout(missing = 0) {
  if (!envManager) return missing;
  return envManager.get("WORKER_TIMEOUT") || missing;
}

export function downloadTimeout(missing = 0) {
  if (!envManager) return missing;
  return envManager.get("CF_BLOCKLIST_DOWNLOAD_TIMEOUT") || missing;
}

export function bgDownloadBlocklistWrapper() {
  if (!envManager) return false;
  return onCloudflare();
}

export function blocklistUrl() {
  if (!envManager) return null;
  return envManager.get("CF_BLOCKLIST_URL");
}

export function primaryDohResolver() {
  if (!envManager) return null;

  return envManager.get("CF_DNS_RESOLVER_URL");
}

export function secondaryDohResolver() {
  if (!envManager) return null;

  return envManager.get("CF_DNS_RESOLVER_URL_2");
}

export function cfAccountId() {
  if (!envManager) return "";
  // a secret
  return envManager.get("CF_ACCOUNT_ID") || "";
}

export function cfApiToken() {
  if (!envManager) return "";
  // a secret
  return envManager.get("CF_API_TOKEN") || "";
}

export function maxDohUrl() {
  if (!envManager) return null;
  return envManager.get("MAX_DNS_RESOLVER_URL");
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

export function geoipUrl() {
  if (!envManager) return null;
  return envManager.get("GEOIP_URL");
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
  if (!envManager) return null;
  return envManager.get("TLS_CRT") || null;
}

export function tlsKey() {
  if (!envManager) return null;
  return envManager.get("TLS_KEY") || null;
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

// sysctl get net.ipv4.tcp_syn_backlog
export function tcpBacklog() {
  if (!envManager) return 600; // same as fly.service soft_limit

  return envManager.get("TCP_BACKLOG") || 600;
}

// don't forget to update the fly.toml too
export function maxconns() {
  if (!envManager) return 1000; // 25% higher than fly.service hard_limit

  return envManager.get("MAXCONNS") || 1000;
}

export function minconns() {
  if (!envManager) return 50;

  return envManager.get("MINCONNS") || 50;
}

export function ioTimeoutMs(missing = 0) {
  if (!envManager) return missing;

  return envManager.get("WORKER_TIMEOUT") || missing;
}

export function shutdownTimeoutMs() {
  if (!envManager) return 60 * 1000;

  return envManager.get("SHUTDOWN_TIMEOUT_MS") || 60 * 1000;
}

export function measureHeap() {
  if (!envManager) return false;
  const reg = region();
  if (
    reg === "bom" ||
    reg === "sin" ||
    reg === "fra" ||
    reg === "ams" ||
    reg === "lhr" ||
    reg === "cdg" ||
    reg === "iad" ||
    reg === "mia"
  ) {
    return true;
  }
  return envManager.get("MEASURE_HEAP") || false;
}

export function blocklistDownloadOnly() {
  if (!envManager) return false;

  // run the server just to download the blocklist files and do nothing else
  return envManager.get("BLOCKLIST_DOWNLOAD_ONLY");
}

export function renewBlocklistsThresholdInWeeks() {
  if (!envManager) return false;

  return envManager.get("AUTO_RENEW_BLOCKLISTS_OLDER_THAN") || -1;
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

export function httpCheckPort() {
  return 8888;
}

export function profileDnsResolves() {
  if (!envManager) return false;

  return envManager.get("PROFILE_DNS_RESOLVES") || false;
}

export function imageRef() {
  if (!envManager) return "";
  if (!onFly()) return "";

  return envManager.get("FLY_IMAGE_REF") || "";
}

export function secretb64() {
  if (!envManager) return null;

  return envManager.get("TOP_SECRET_512_B64") || null;
}

export function accessKeys() {
  if (!envManager) return "";

  return envManager.get("ACCESS_KEYS") || null;
}

export function forceDoh() {
  if (!envManager) return true;

  // on other runtimes, continue using doh
  if (!isNode()) return true;

  // on node, default to using plain old dns
  return envManager.get("NODE_DOH_ONLY") || false;
}

export function disableDnsCache() {
  // disable when profiling dns resolutions
  return profileDnsResolves();
}

export function disableBlocklists() {
  if (!envManager) return false;

  // server is up just to download blocklists, so skip this flag
  if (blocklistDownloadOnly()) return false;

  return envManager.get("DISABLE_BLOCKLISTS") || false;
}

export function blockSubdomains() {
  if (!envManager) return true;

  return envManager.get("BLOCK_SUBDOMAINS") || true;
}

// recurisve resolver on Fly
// see: node/config.js#prep
export function recursive() {
  return onFly();
}

export function logpushEnabled() {
  if (!envManager) return false;

  return envManager.get("LOGPUSH_ENABLED") || false;
}

export function logpushHostnameAsLogid() {
  if (!envManager) return false;

  return envManager.get("LOGPUSH_HOSTNAME_AS_LOGID") || false;
}

// returns a set of subdomains on which logpush is enabled
export function logpushSources() {
  if (!envManager) return null;

  const csv = envManager.get("LOGPUSH_SRC") || null;
  if (onCloudflare() || onLocal()) return csv;

  return null;
}

export function logpushPath() {
  if (!envManager) return "";

  const path = envManager.get("CF_LOGPUSH_R2_PATH") || "";
  if (onCloudflare() || onLocal()) return path;

  return "";
}

export function logpushAccessKey() {
  if (!envManager) return "";

  const accesskey = envManager.get("CF_LOGPUSH_R2_ACCESS_KEY") || "";
  if (onCloudflare() || onLocal()) return accesskey;

  return "";
}

export function logpushSecretKey() {
  if (!envManager) return "";

  const secretkey = envManager.get("CF_LOGPUSH_R2_SECRET_KEY") || "";
  if (onCloudflare() || onLocal()) return secretkey;

  return "";
}

export function gwip4() {
  if (!envManager) return "";
  return envManager.get("GW_IP4") || "";
}

export function gwip6() {
  if (!envManager) return "";
  return envManager.get("GW_IP6") || "";
}

export function region() {
  if (!envManager) return "";
  return envManager.get("FLY_REGION") || "";
}

export function metrics() {
  const nobinding = [null, null];

  if (!envManager) return nobinding;

  // match the binding names as in wrangler.toml
  if (onCloudflare()) {
    return [
      envManager.get("METRICS") || null,
      envManager.get("BL_METRICS") || null,
    ];
  }

  return nobinding;
}
