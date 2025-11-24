#### It's a bird, it's a plane, it's... a self-hosted, pi-hole esque, DNS resolver

_serverless-dns_ is a Pi-Hole esque [content-blocking](https://github.com/serverless-dns/blocklists), serverless, stub DNS-over-HTTPS (DoH) and DNS-over-TLS (DoT) resolver. Runs out-of-the-box on [Cloudflare Workers](https://workers.dev), [Deno Deploy](https://deno.com/deploy), [Fastly Compute@Edge](https://www.fastly.com/products/edge-compute), and [Fly.io](https://fly.io/). Free tiers of all these services should be enough to cover 10 to 20 devices worth of DNS traffic per month.

### The RethinkDNS resolver

RethinkDNS runs `serverless-dns` in production at these endpoints:

| Cloud platform     | Server locations | Protocol    | Domain                    | Usage                                   |
|--------------------|------------------|-------------|---------------------------|-----------------------------------------|
| ⛅ Cloudflare Workers | 280+ ([ping](https://check-host.net/check-ping?host=https://sky.rethinkdns.com))           | DoH         | `sky.rethinkdns.com`    | [configure](https://rethinkdns.com/configure?p=doh)  |
| 🦕 Deno Deploy        | 30+ ([ping](https://check-host.net/check-ping?host=https://deno.dev))                      | DoH         | _private beta_          |                                         |
| ⏱️ Fastly Compute@Edge   | 80+ ([ping](https://check-host.net/check-ping?host=https://serverless-dns.edgecompute.app))| DoH         | _private beta_          |                                      |
| 🪂 Fly.io             | 30+ ([ping](https://check-host.net/check-ping?host=https://max.rethinkdns.com))           | DoH and DoT | `max.rethinkdns.com`      | [configure](https://rethinkdns.com/configure?p=dot)  |

Server-side processing takes from 0 milliseconds (ms) to 2ms (median), and end-to-end latency (varies across regions and networks) is between 10ms to 30ms (median).

[<img src="https://raw.githubusercontent.com/fossunited/Branding/main/asset/FOSS%20United%20Logo/Extra/Extra%20Logo%20white%20on%20black.jpg"
     alt="FOSS United"
     height="40">](https://fossunited.org/grants)&emsp;
[<img src="https://floss.fund/static/badge.svg"
    alt="FLOSS/fund badge"
    height="40">](https://floss.fund)

The *Rethink DNS* resolver on Fly.io is sponsored by [FLOSS/fund](https://floss.fund) and FOSS United.

### Self-host

Cloudflare Workers is the easiest platform to setup `serverless-dns`:

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/serverless-dns/serverless-dns)

[![Deploy to Fastly](https://deploy.edgecompute.app/button)](https://deploy.edgecompute.app/deploy)

For step-by-step instructions, refer:

| Platform       | Difficulty | Runtime                                | Doc                                                                                     |
| ---------------| ---------- | -------------------------------------- | --------------------------------------------------------------------------------------- |
| ⛅ Cloudflare  | Easy       | [v8](https://v8.dev) _Isolates_        | [Hosting on Cloudflare Workers](https://docs.rethinkdns.com/dns/open-source#cloudflare) |
| 🦕 Deno.com    | Moderate   | [Deno](https://deno.land) _Isolates_   | [Hosting on Deno.com](https://docs.rethinkdns.com/dns/open-source#deno-deploy)          |
| ⏱️ Fastly Compute@Edge | Easy  | [Fastly JS](https://js-compute-reference-docs.edgecompute.app/)| [Hosting on Fastly Compute@Edge](https://docs.rethinkdns.com/dns/open-source#fastly) |
| 🪂 Fly.io      | Hard       | [Node](https://nodejs.org) _MicroVM_   | [Hosting on Fly.io](https://docs.rethinkdns.com/dns/open-source#fly-io)                 |

To setup blocklists, visit `https://<my-domain>.tld/configure` from your browser (it should load something similar to [RethinkDNS' _configure_ page](https://rethinkdns.com/configure)).

For help or assistance, feel free to [open an issue](https://github.com/celzero/docs/issues) or [submit a patch](https://github.com/celzero/docs).

---

### Development
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/serverless-dns/serverless-dns/badge)](https://securityscorecards.dev/viewer/?uri=github.com/serverless-dns/serverless-dns)&emsp;
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/serverless-dns/serverless-dns)

#### Setup

Code:
```bash
# navigate to work dir
cd /my/work/dir

# clone this repository
git clone https://github.com/serverless-dns/serverless-dns.git

# navigate to serverless-dns
cd ./serverless-dns
```

Node:
```bash
# install node v22+ via nvm, if required
# https://github.com/nvm-sh/nvm#installing-and-updating
wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash
nvm install --lts

# download dependencies
npm i

# (optional) update dependencies
npm update

# run serverless-dns on node
./run n

# run a clinicjs.org profiler
./run n [cpu|fn|mem]
```

Deno:
```bash
# install deno.land v2+
# https://github.com/denoland/deno/#install
curl -fsSL https://deno.land/install.sh | sh

# run serverless-dns on deno
./run d
```

Fastly:
```bash
# install node v22+ via nvm, if required
# install the Fastly CLI
# https://developer.fastly.com/learning/tools/cli

# run serverless-dns on Fastly Compute@Edge
./run f
```

Wrangler:
```bash
# install Cloudflare Workers (cli) aka Wrangler
# https://developers.cloudflare.com/workers/cli-wrangler/install-update
npm i wrangler --save-dev

# run serverless-dns on Cloudflare Workers (cli)
# Make sure to setup Wrangler first:
# https://developers.cloudflare.com/workers/cli-wrangler/authentication
./run w

# profile wrangler with Chrome DevTools
# blog.cloudflare.com/profiling-your-workers-with-wrangler
```

#### Code style

Commits on this repository enforces the Google JavaScript style guide (ref: [.eslintrc.cjs](.eslintrc.cjs)).
A git `pre-commit` hook that runs linter (eslint) and formatter (prettier) on `.js` files. Use `git commit --no-verify`
to bypass this hook.

Pull requests are also checked for code style violations and fixed automatically where possible.

#### Env vars

Configure [`env.js`](src/core/env.js) if you need to tweak the defaults.
For Cloudflare Workers, setup env vars in [`wrangler.toml`](wrangler.toml), instead.
For Fastly Compute@Edge, setup env vars in [`fastly.toml`](fastly.toml), instead.

#### Request flow

1. The request/response flow: client <-> `src/server-[node|workers|deno]` <-> [`doh.js`](src/core/doh.js) <-> [`plugin.js`](src/core/plugin.js)
2. The `plugin.js` flow: `user-op.js` -> `cache-resolver.js` -> `cc.js` -> `resolver.js`

#### Auth

serverless-dns supports authentication with an *alpha-numeric* bearer token for both DoH and DoT. For a token, `msg-key` (secret), append the output of `hex(hmac-sha256(msg-key|domain.tld), msg)` to `ACCESS_KEYS` env var in csv format. Note: `msg` is currently fixed to `sdns-public-auth-info`.

1. DoH: place the `msg-key` at the end of the blockstamp, like so:
`1:4AIggAABEGAgAA:<msg-key>` (here, `1` is the version, `1:4AIggAABEGAgAA`
is the blockstamp, `<msg-key>` is the auth secret, and `:` is the delimiter).
2. DoT: place the `msg-key` at the end of the SNI (domain-name) containing the blockstamp:
`1-4abcbaaaaeigaiaa-<msg-key>` (here `1` is the version, `4abcbaaaaeigaiaa`
is the blockstamp, `<msg-key>` is the auth secret, and `-` is the delimeter).

If the intention is to use auth with DoT too, keep `msg-key` shorter (8 to 24 chars), since subdomains may only be 63 chars long in total.

You can generate the access keys for your fork from `max.rethinkdns.com`, like so:
```bash
msgkey="ShortAlphanumericSecret"
domain="my-serverless-dns-domain.tld"
curl 'https://max.rethinkdns.com/genaccesskey?key='"$msgkey"'&dom='"$domain"
# output
# {"accesskey":["my-serverless-dns-domain.tld|deadbeefd3adb33fa2bb33fd3eadf084beef3b152beefdead49bbb2b33fdead83d3adbeefdeadb33f"],"context":"sdns-public-auth-info"}
```

#### TLS PSK

serverless-dns also supports TLS PSK ciphersuites when env var `TLS_PSK` is set to hex or base64 of randomly generated 64 bytes. Works only on cloud deployments that terminate their own TLS (like on Fly.io).

The server-hint sent to the TLS 1.2 clients is fixed to [`888811119999`](https://github.com/serverless-dns/serverless-dns/blob/42a880666e/src/core/psk.js#L11).

*Static PSK*: TLS 1.2 clients must set client-hint (`id`) as hex string from [`790bb453...ffae2452`](https://github.com/serverless-dns/serverless-dns/blob/42a880666e/src/core/psk.js#L14-L20). The static pre-shared key is then derived from `hkdf-sha256(key, id)` where `key` is itself `hkdf-sha256(seed, sha512(ctx), salt)`:
- `seed` is env var `TLS_PSK` converted to bytes from base64 or hex.
- `ctx` is [UTF-8 encoding](https://github.com/serverless-dns/serverless-dns/blob/42a880666e/src/core/psk.js#L21-L27) of string `pskkeyfixedderivationcontext`.
- `salt` is fixed from [`44f402e7...91a6e3ce`](https://github.com/serverless-dns/serverless-dns/blob/42a880666e/src/core/psk.js#L21-L27) converted to bytes.
- `id` is the static client-hint from above (`790bb453...ffae2452`) converted to bytes.

*Dynamic PSK*: For TLS 1.2 clients, to use a dynamically generated PSK identity and key (derived from env var `TLS_PSK`), invoke `<my-domain.tld>/gentlspsk`. The returned credentials are valid as long as `TLS_PSK` is unchanged:

```js
{
    // 64 hex chars; id is to be used as-is as the psk client identity.
    "id":"43dc2df4...6d332545",
    // 128 hex chars; convert to 64-length byte array to use as psk shared secret.
    "psk":"ebc9ab07...03629dd4"
}
```

TLS *early data* (0-RTT) for TLS 1.3 (via TLS PSK) is not supported by Node.<sup>([why?](https://github.com/serverless-dns/serverless-dns/issues/30#issuecomment-997167459))</sup>

#### Logs and Analytics

serverless-dns can be setup to upload logs via Cloudflare *Logpush*.

0. Setup a *Logpush* job:
    ```bash
    CF_ACCOUNT_ID=<hex-cloudflare-account-id>
    CF_API_KEY=<api-key-with-logs-edit-permission-at-account-level>
    R2_BUCKET=<r2-bucket-name>
    R2_ACCESS_KEY=<r2-access-key-for-the-bucket>
    R2_SECRET_KEY=<r2-secret-key-with-read-write-permissions>
    # optional, setup a filter such that only logs form this worker ends up being pushed; but if you
    # do not need a filter on Worker name (script-name), edit the "filter" field below accordingly.
    SCRIPT_NAME=<name-of-the-worker-as-in-wrangler-toml>
    # for more options, ref: developers.cloudflare.com/logs/get-started/api-configuration
    # Logpush API with cURL: developers.cloudflare.com/logs/tutorials/examples/example-logpush-curl
    # Available Logpull fields: developers.cloudflare.com/logs/reference/log-fields/account/workers_trace_events
    curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/logpush/jobs" \
        -H "Authorization: Bearer ${CF_API_KEY}" \
        -H 'Content-Type: application/json' \
        -d '{
            "name": "dns-logpush",
            "logpull_options": "fields=EventTimestampMs,Outcome,Logs,ScriptName&timestamps=rfc3339",
            "destination_conf": "r2://'"$R2_BUCKET"'/{DATE}?access-key-id='"${R2_ACCESS_KEY}"'&secret-access-key='"${R2_SECRET_KEY}"'&account-id='"{$CF_ACCOUNT_ID}"',
            "dataset": "workers_trace_events",
            "filter": "{\"where\":{\"and\":[{\"key\":\"ScriptName\",\"operator\":\"contains\",\"value\":\"'"${SCRIPT_NAME}"'\"},{\"key\":\"Outcome\",\"operator\":\"eq\",\"value\":\"ok\"}]}}",
            "enabled": true,
            "frequency": "low"
        }'
    ```
1. Set `wrangler.toml` property `logpush = true`, which enables *Logpush*.
2. (Optional) env var `LOG_LEVEL = "logpush"`, which raises the log-level such that only *request* and error logs are emitted.
3. (Optional) Set env var `LOGPUSH_SRC = "csv,of,subdomains"`, which makes [`log-pusher.js`](./src/plugins/observability/log-pusher.js) emit *request* logs only if Workers `hostname` contains one of the subdomains.

Logs published to R2 can be retrieved either using [R2 Workers](https://developers.cloudflare.com/r2/data-access/workers-api/workers-api-usage), the [R2 API](https://developers.cloudflare.com/r2/data-access/s3-api/api), or the [Logpush API](https://developers.cloudflare.com/logs/r2-log-retrieval).

Workers Analytics, if enabled, is pushed against a log-key, `lid`, which if unspecified is set to hostname of the serverless deployment with periods, `.`, replaced with underscores, `_`. Auth must be setup when querying for Analytics via the API which returns a json; ex: `https://max.rethinkdns.com/1:<optional-stamp>:<msg-key>/analytics?t=<time-interval-in-mins>&f=<field-name>`. Possible `fields` are `ip` (client ip), `qname` (dns query name), `region` (resolver region), `qtype` (dns query type), `dom` (top-level domains), `ansip` (dns answer ips), and `cc` (ans ip country codes).

Log capture and analytics isn't yet implemented for Fly and Deno Deploy.

----

#### A note about runtimes

Deno Deploy (cloud) and Deno (the runtime) do not expose the same API surface (for example, Deno Deploy only
supports HTTP/S server-listeners; whereas, Deno suports raw TCP/UDP/TLS in addition to plain HTTP and HTTP/S).

Except on Node, `serverless-dns` uses DoH upstreams defined by env vars, `CF_DNS_RESOLVER_URL` / `CF_DNS_RESOLVER_URL_2`.
On Node, the default DNS upstream is `1.1.1.2` ([ref](https://github.com/serverless-dns/serverless-dns/blob/15f628460/src/commons/dnsutil.js#L28)) or the recursive DNS resolver at `fdaa::3` when running on Fly.io.

The entrypoints for Node and Deno are [`src/server-node.js`](src/server-node.js), [`src/server-deno.ts`](src/server-deno.ts) respectively,
and both listen for TCP-over-TLS, HTTP/S connections; whereas, the entrypoint for Cloudflare Workers, which only listens over HTTP (cli) or
over HTTP/S (prod), is [`src/server-workers.js`](src/server-workers.js); and for Fastly its [`src/server-fastly.js`](src/server-fastly.js).

Local (non-prod) setups on Node, `key` (private) and `cert` (public chain) files, by default, are read from
paths defined in env vars, `TLS_KEY_PATH` and `TLS_CRT_PATH`.

Whilst for prod setup on Node (on Fly.io), either `TLS_OFFLOAD` must be set to `true` or `key` and `cert` _must_ be
_base64_ encoded in env var `TLS_CERTKEY` ([ref](https://github.com/serverless-dns/serverless-dns/blob/f57c579/src/core/node/config.js#L61-L92)), like so:

```bash
# EITHER: offload tls to fly.io and set tls_offload to true
TLS_OFFLOAD="true"
# OR: base64 representation of both key (private) and cert (public chain)
TLS_CERTKEY="KEY=b64_key_content\nCRT=b64_cert_content"
# OPTIONALLY: use TLS with PSK ciphers (also permits domain fronting)
TLS_PSK="hex-or-base64(cryptographically-secure-random-64bytes)"
# OPTIONALLY: set TLS_ALLOW_ANY_SNI to true to permit domain fronting
TLS_ALLOW_ANY_SNI="true"
```

For Deno, `key` and `cert` files are read from paths defined in env vars, `TLS_KEY_PATH` and `TLS_CRT_PATH` ([ref](https://github.com/serverless-dns/serverless-dns/blob/270d1a3c/src/server-deno.ts#L32-L35)).

_Process_ bringup is different for each of these runtimes: For Node, [`src/core/node/config.js`](src/core/node/config.js) governs the _bringup_;
while for Deno, it is [`src/core/deno/config.ts`](src/core/deno/config.ts), and for Workers it is [`src/core/workers/config.js`](src/core/workers/config.js).
[`src/system.js`](src/system.js) pub-sub co-ordinates the _bringup_ phase among various modules.

On Node and Deno, in-process DNS caching is backed by [`@serverless-dns/lfu-cache`](https://github.com/serverless-dns/lfu-cache); Cloudflare Workers is backed by both [Cache Web API](https://developers.cloudflare.com/workers/runtime-apis/cache) and
in-process lfu caches. To disable caching altogether on all three platfroms, set env var, `PROFILE_DNS_RESOLVES=true`.

#### Cloud

Cloudflare Workers, and Deno Deploy are ephemeral, as in, the "process" that serves client requests is not long-lived,
and in fact, two back-to-back requests may be served by two different [_isolates_](https://developers.cloudflare.com/workers/learning/how-workers-works) ("processes"). Fastly Compute@Edge is the also ephemeral but does not use isolates, instead Fastly creates and destroys a [wasmtime](https://wasmtime.dev/) sandbox for each request. Resolver on Fly.io, running Node, is backed by [persistent VMs](https://fly.io/blog/docker-without-docker/) and is hence longer-lived,
like traditional "serverfull" environments.

For Deno Deploy, the code-base is bundled up in a single javascript file with `deno bundle` and then handed off
to Deno.com.

Cloudflare Workers build-time and runtime configurations are defined in [`wrangler.toml`](wrangler.toml).
[Webpack5 bundles the files](webpack.config.cjs) in an ESM module which is then uploaded to Cloudflare by _Wrangler_.

Fastly Compute@Edge build-time and runtime configurations are defined in [`fastly.toml`](fastly.toml).
[Webpack5 bundles the files](webpack.fastly.cjs) in an ESM module which is then compiled to WASM by `npx js-compute-runtime`
and subsequently packaged and published to Fastly Compute@Edge with the _Fastly CLI_.

For Fly.io, which runs Node, the runtime directives are defined in [`fly.toml`](fly.toml) (used by `dev` and `live` deployment-types),
while deploy directives are in [`node.Dockerfile`](node.Dockerfile). [`flyctl`](https://fly.io/docs/flyctl) accordingly sets
up `serverless-dns` on Fly.io's infrastructure.

```bash
# build and deploy for cloudflare workers.dev
npm run build
# usually, env-name is prod
npx wrangler publish [-e <env-name>]

# bundle, build, and deploy for fastly compute@edge
# developer.fastly.com/reference/cli/compute/publish
fastly compute publish

# build and deploy to fly.io
npm run build:fly
flyctl deploy --dockerfile node.Dockerfile --config <fly.toml> [-a <app-name>] [--image-label <some-uniq-label>]
```

For deploys offloading TLS termination to Fly.io (`B1` deployment-type), the runtime directives are instead defined in
[`fly.tls.toml`](fly.tls.toml), which sets up HTTP2 Cleartext and HTTP/1.1 on port `443`, and DNS over TCP on port `853`.

Ref: _[github/workflows](.github/workflows)_.

### Blocklists

200+ blocklists are compressed in a _Succinct Radix Trie_ ([based on Steve Hanov's impl](https://stevehanov.ca/blog/?id=120)) with modifications
to speed up string search ([`lookup`](https://github.com/serverless-dns/trie/blob/965007a5c/src/ftrie.js#L378-L484)) at the expense of "succintness". The blocklists are versioned
with unix timestamp (defined in `src/basicconfig.json` downloaded by [`pre.sh`](src/build/pre.sh)), which is generated once every week, but we'd like to generate 'em daily / hourly,
if possible [see](https://github.com/serverless-dns/blocklists/issues/19)), and hosted on Cloudflare R2 (env var: `CF_BLOCKLIST_URL`).

`serverless-dns` downloads [blocklist files](https://github.com/serverless-dns/serverless-dns/blob/15f62846/src/core/node/blocklists.js#L14-L16)
required to setup the radix-trie during runtime bring-up or, downloads them [lazily](https://github.com/serverless-dns/serverless-dns/blob/02f9e5bf/src/plugins/dns-op/resolver.js#L167),
when serving a DNS request.

`serverless-dns` compiles around ~17M entries (as of Nov 2025) from around 200+ blocklists. These are defined in the [serverless-dns/blocklists](https://github.com/serverless-dns/blocklists) repository.
