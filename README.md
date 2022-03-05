#### It's a bird, it's a plane, it's... a self-hosted, pi-hole esque, DNS resolver

_serverless-dns_ is a Pi-Hole esque [content-blocking](https://github.com/serverless-dns/blocklists), serverless, stub DNS-over-HTTPS (DoH) and DNS-over-TLS (DoT) resolver. Runs out-of-the-box on [Cloudflare Workers](https://workers.dev), [Deno Deploy](https://deno.com/deploy), and [Fly.io](https://fly.io/). Free tiers of all these services should be enough to cover 10 to 20 devices worth of DNS traffic per month.

### The RethinkDNS resolver

RethinkDNS runs `serverless-dns` in production at these endpoints:

| Cloud platform     | Server locations | Protocol    | Domain                    | Usage                                   |
|--------------------|------------------|-------------|---------------------------|-----------------------------------------|
| ⛅ Cloudflare Workers | 200+ ([ping](https://check-host.net/check-ping?host=https://basic.rethinkdns.com))        | DoH         | `basic.rethinkdns.com`    | [configure](https://rethinkdns.com/configure?p=doh)  |
| 🦕 Deno Deploy        | 30+ ([ping](https://check-host.net/check-ping?host=https://deno.dev))                     | DoH         | _private beta_            |                                         |
| 🪂 Fly.io             | 30+ ([ping](https://check-host.net/check-ping?host=https://max.rethinkdns.com))           | DoH and DoT | `max.rethinkdns.com`      | [configure](https://rethinkdns.com/configure?p=dot)  |

Server-side processing takes from 0 milliseconds (ms) to 2ms (median), and end-to-end latency (varies across regions and networks) is between 10ms to 30ms (median).

### Self-host

Cloudflare Workers is the easiest platform to setup `serverless-dns`: 

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/serverless-dns/serverless-dns/)

For step-by-step instructions, refer:

| Platform       | Difficulty | Runtime                                | Doc                                                                                     |
| ---------------| ---------- | -------------------------------------- | --------------------------------------------------------------------------------------- |
| ⛅ Cloudflare  | Easy       | [v8](https://v8.dev) _Isolates_        | [Hosting on Cloudflare Workers](https://docs.rethinkdns.com/dns/open-source#cloudflare) |
| 🦕 Deno.com    | Moderate   | [Deno](https://deno.land) _Isolates_   | [Hosting on Deno.com](https://docs.rethinkdns.com/dns/open-source#deno-deploy)          |
| 🪂 Fly.io      | Hard       | [Node](https://nodejs.org) _MicroVM_   | [Hosting on Fly.io](https://docs.rethinkdns.com/dns/open-source#fly-io)                 |

To setup blocklists, visit `https://<my-domain>.tld/configure` from your browser (it should load something similar to [RethinkDNS' _configure_ page](https://rethinkdns.com/configure)).

For help or assistance, feel free to [open an issue](https://github.com/celzero/docs/issues) or [submit a patch](https://github.com/celzero/docs).

---

### Development

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
```
# install node v16+ via nvm, if required
# https://github.com/nvm-sh/nvm#installing-and-updating
wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash
nvm install --lts

# get js dependencies
npm i

# (optional) update dependencies
npm update

# run serverless-dns on node
./run n
```

Deno and Wrangler:
```bash
# (optional) install Cloudflare Workers (cli) aka Wrangler
# https://developers.cloudflare.com/workers/cli-wrangler/install-update
npm i @cloudflare/wrangler -g

# (optional) install deno.land v1.18+
# https://github.com/denoland/deno/#install
curl -fsSL https://deno.land/install.sh | sh

# (optional) run serverless-dns on deno
./run d

# (optional) run serverless-dns on Cloudflare Workers (cli)
# Make sure to setup Wrangler first:
# https://developers.cloudflare.com/workers/cli-wrangler/authentication
./run w

```

#### Code style

Commits on this repository enforces the Google JavaScript style guide (ref: [.eslintrc.cjs](.eslintrc.cjs)).
A git `pre-commit` hook that runs linter (eslint) and formatter (prettier) on `.js` files. Use `git commit --no-verify`
to bypass this hook.

Pull requests are also checked for code style violations and fixed automatically where possible.

#### Env vars

Configure `.env` ([ref](.env.example)) or [`env.js`](src/core/env.js) if you need to tweak the defaults.
Values in `.env` file take precedence over corresponding variables set in `env.js`. For Cloudflare Workers
setup env vars in [`wrangler.toml`](wrangler.toml), instead.

#### Request flow

1. The request/response flow is: client <-> `src/server-[node|workers|deno]` <-> [`doh.js`](src/core/doh.js) <-> [`plugin.js`](src/core/plugin.js)
2. The `plugin.js` flow: `userOperation.js` -> `cacheResponse.js` -> `cc.js` -> `dnsResolver.js`

----

#### A note about runtimes

Deno Deploy (cloud) and Deno (the runtime) do not expose the same API surface (for example, Deno Deploy only
supports HTTP/S server-listeners; whereas, Deno suports raw TCP/UDP/TLS in addition to plain HTTP and HTTP/S).

Except on Node, `serverless-dns` uses DoH upstreams defined by env vars, `CF_DNS_RESOLVER_URL` / `CF_DNS_RESOLVER_URL_2`.
On Node, the default DNS upstream is `1.1.1.2` ([ref](https://github.com/serverless-dns/serverless-dns/blob/15f628460/src/commons/dnsutil.js#L28)).

The entrypoint for Node and Deno are [`src/server-node.js`](src/server-node.js), [`src/server-deno.ts`](src/server-deno.ts) respectively,
and both listen for TCP-over-TLS, HTTP/S connections; whereas, the entrypoint for Cloudflare Workers, which only listens over HTTP (cli) or
over HTTP/S (prod), is [`src/server-workers.js`](src/server-workers.js).

For prod setups on Deno and local (non-prod) setups on Node, the key (private) and cert (public chain)
files, by default, are read from paths defined in env vars, `TLS_KEY_PATH` and `TLS_CRT_PATH`.

Whilst for prod setup on Node, the key and cert _must_ be
_base64_ encoded in env var via `TLS_CN` ([ref](https://github.com/serverless-dns/serverless-dns/blob/15f62846/src/core/node/config.js#L61-L82)), like so:

```bash
# defines the domain name in uppercase for which certs have to be loaded for
# period '.' is subst with `_`, ie, d1.rethinkdns.com is:
TLS_CN="D1_RETHINKDNS_COM"

# base64 representation of both key (private) and cert (public chain)
D1_RETHINKDNS_COM="KEY=b64_key_content\nCRT=b64_cert_content"

# note: The env var name "D1_RETHINKDNS_COM" the value stored in env var, TLS_CN
```

_Process_ bringup is different for each of these runtimes: For Node, [`src/core/node/config.js`](src/core/node/config.js) governs the _bringup_;
while for Deno, it is [`src/core/deno/config.ts`](src/core/deno/config.ts) and for Workers it is [`src/core/workers/config.js`](src/core/workers/config.js).
[`src/system.js`](src/system.js) pub-sub co-ordinates the _bringup_ phase among various modules.

On Node and Deno, in-process DNS caching, backed by [`@serverless-dns/lfu-cache`](https://github.com/serverless-dns/lfu-cache)
is used; on Cloudflare Workers, both, [Cache Web API](https://developers.cloudflare.com/workers/runtime-apis/cache) and
in-process caches are used. To disable caching altogether on all three platfroms, set env var, `PROFILE_DNS_RESOLVES=true`.

#### Cloud

Cloudflare Workers and Deno Deploy are ephemeral, as in, the process that serves client request is not long-lived,
and in fact, two back-to-back requests may be served by two different [_isolates_](https://developers.cloudflare.com/workers/learning/how-workers-works) (processes). Resolver on Fly.io, running Node, is backed by [persistent VMs](https://fly.io/blog/docker-without-docker/) and is hence longer-lived,
like traditional "serverfull" environments.

Cloudflare Workers build-time and runtime configurations are defined in [`wrangler.toml`](wrangler.toml).
[Webpack5 bundles the files](webpack.config.cjs) in an ESM module which is then uploaded to Cloudflare by _Wrangler_.

For Deno Deploy, the code-base is bundled up in a single javascript file with `deno bundle` and then handed off
to Deno.com.

For Fly.io, which runs Node, the runtime directives are defined in [`fly.toml`](fly.toml), while deploy directives
are in [`node.Dockerfile`](node.Dockerfile). [`flyctl`](https://fly.io/docs/flyctl) accordingly sets up `serverless-dns`
on Fly.io's infrastructure.

Ref: _[github/workflows](.github/workflows)_.

### Blocklists

190+ blocklists are compressed in a _Succinct Radix Trie_ ([based on Steve Hanov's impl](https://stevehanov.ca/blog/?id=120)) with modifications
to speed up string search ([`lookup`](src/plugins/blocklist-wrapper/radixTrie.js)) at the expense of "succintness". The blocklists are versioned
with unix timestamp (env var: `CF_LATEST_BLOCKLIST_TIMESTAMP`), and generated once every week, but we'd like to generate 'em daily / hourly,
if possible [see](https://github.com/serverless-dns/blocklists/issues/19)), and hosted on Lightsail Object Store (env var: `CF_BLOCKLIST_URL`).
`serverless-dns` downloads [3 blocklist files](https://github.com/serverless-dns/serverless-dns/blob/15f62846/src/core/node/blocklists.js#L14-L16)
required to setup the radix trie during runtime bringup or, [lazily](https://github.com/serverless-dns/serverless-dns/blob/15f62846/src/plugins/dns-operation/dnsResolver.js#L167), when serving a DNS request.

`serverless-dns` compiles around ~5M entries (as of Feb 2022) in to a succinct radix trie, from around 190+ blocklists. These are defined in [serverless-dns/blocklists](https://github.com/serverless-dns/blocklists) repository.
