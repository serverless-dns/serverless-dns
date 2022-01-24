This is free, open source RethinkDNS serverless DoH and DoT resolvers with custom blocklists
that can be hosted on cloudflare, fly.io and deno-deploy. This initiative is to provide first level of
anti-censorship and data privacy to every person on the earth.

## For the People

Easiest way to host this serverless dns would be to use Cloudflare. Click the below button to deploy. User will be liable for cloudflare billing.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/serverless-dns/serverless-dns/)

Instructions for configuring, like changing recursive resolver and other platforms available to host are linked from the table below.

| Platform      | Difficulty | Resolver Protocol | Instructions                                                                            |
| ------------- | ---------- | ----------------- | --------------------------------------------------------------------------------------- |
| ⛅ Cloudflare  | Easy       | HTTPS             | [Hosting on Cloudflare Workers](https://docs.rethinkdns.com/dns/open-source#cloudflare) |
| 🦕 Deno Deploy | Moderate   | HTTPS             | [Hostng on Deno.com](https://docs.rethinkdns.com/dns/open-source#deno-deploy)           |
| 🪰 Fly         | Hard       | TLS & HTTPS       | [Hosting on Fly.io](https://docs.rethinkdns.com/dns/open-source#fly-io)                 |

---

_Rest of this README is intended for software developers._

---

## For the Developers

### Style Guide

This repository enforces a certain style guide as configured in [.eslintrc.cjs](.eslintrc.cjs) file.

To help with style guide, there exists a git `pre-commit` hook that runs eslint
on `.js` files before a commit is made. This may fix a few issues & format the
code with prettier.

Commit will fail if there are any "error" level style guide violations which
couldn't be fixed automatically.

Run `npm i` or `npm prepare` to set up the hook.

Use `git commit --no-verify` to bypass this hook.

Pull requests are also checked for style guide violations and fixed automatically
if possible.

### Runtimes

#### Deno

Run:

```
deno run --allow-net --allow-env --allow-read --import-map=import_map.json src/server-deno.ts
```

List of environment variables can be found in [`.env.example`](.env.example)
file. Load them as required. For convenience, you can also put them in a `.env`
file and they will also be loaded into the environment.

Runtime API:
- https://doc.deno.land/deno/stable
- https://doc.deno.land/deno/unstable

NOTE: Runtime API of deno-deploy differs from that of Deno. See below.

#### Node

Run:

```
node src/server-node.js
```

Proxies DNS over HTTPS & DNS over TLS requests to the main app (`index.js`).

List of environment variables can be found in [`.env.example`](.env.example)
file. Load them as required. For convenience in non-production environment, you
can also put them in a `.env` file and they will be loaded into the environment
if not already present.

### Platforms

#### Deno Deploy

Runtime API: https://deno.com/deploy/docs/runtime-api

### Flow

The flow of rethink dns is based on plugin module, current
[plugin flow](src/core/plugin.js) is as below. Five plugins are currently loaded.

1. [CommandControl](src/plugins/command-control)<br> This
	 is optional plugin used to provide command to rethink serverless dns using
	 GET request.
2. [UserOperation](src/plugins/basic)<br> This plugin
	 loads current user details if not found in cache.<br> e.g. dns resolve
	 `google.com` request to rethink serverless cloudflare resolver
	 `https://example.com/1:AIAA7g==`, configuration string `1:AIAA7g==` is
	 treated as user id and loads selected blocklists files for configuration
	 string and cache it under user id.
3. [DNSBlock](src/plugins/dns-operation/dnsBlock.js)<br>
	 This is optional plugin used to check whether requested domain should be
	 blocked or processed further.
4. [DNSResolver](src/plugins/dns-operation/dnsResolver.js)<br>
	 This plugin forward dns request to upstream resolver based on environment
	 variable `CF_DNS_RESOLVER_URL` if not blocked by DNSBlock plugin.
5. [DNSCnameBlock](src/plugins/dns-operation/dnsCnameBlock.js)<br>
	 This is optional plugin used to check whether dns resolved response contains
	 cname and cname has blocked domain name, if cname has blocked domain name
	 then request is blocked.

### Custom Plugin

Custom plugins can be developed by adding following function to class

```javascript
export class CustomPlugin {
	constructor() {
	}
	async RethinkModule(param) {
		let response = {};
		response.isException = false;
		response.exceptionStack = "";
		response.exceptionFrom = "";
		response.data = {};
		try {
		} catch (e) {
			response.isException = true;
			response.exceptionStack = e.stack;
			response.exceptionFrom = "CustomPlugin RethinkModule";
		}
		return response;
	}
}
```

- `RethinkModule(param)` is entry point for every plugin.
- Inside `RethinkModule` method your custom logic can be build for your rethink
	serverless dns.
- example if published to npm as `@your-plugin/plugin`
- add your plugin to rethink serverless dns at [src/helpers/plugin.js](src/helpers/plugin.js)

```javascript
/**
 * Import and Initialize plugins
 */
import { CustomPlugin } from "@your-plugin/plugin";
const customPlugin = new CustomPlugin();

// Start RethinkPlugin constructor

/**
 * Here, register the plugins that should run before custom plugin if any.
 * So as if any of it's output is available to the next plugin. For example,
 * "userBlocklistInfo" is the output of "userOperation" plugin and is only
 * available after it's run.
 */

/**
 * custom plugin registration
 */
this.registerPlugin(
	"customPlugin",
	customPlugin,
	["event", "userBlocklistInfo", "dnsResolverResponse"],
	customCallBack,
	false,
);

/**
 * Here, register the plugins that should run after custom plugin if any.
 */

// End RethinkPlugin constructor

/**
 * custom plugin call back after execution
 */
function customCallBack(response, currentRequest) {
	if (response.isException) {
		loadException(response, currentRequest);
	} else if (response.data.decision) {
		currentRequest.stopProcessing = true;
	} else {
		// "customResponse" param can be registered and passed onto next plugin
		this.registerParameter("customResponse", response.data);
	}
}
```

- `this.registerPlugin(Plugin_Name, Plugin_Object , [Parameters_to_Plugin], Plugin_Callback_Function, Plugin_Execution_After_StopProcessing)`
	- `Plugin_Name` - string denotes name of the plugin.
	- `Plugin_Object` - object of plugin class, which implements RethinkModule
		function within class.
	- `Parameters_to_Plugin` - list of parameters passed to RethinkModule
		function.
	- `Plugin_Callback_Function` - function that will be called back after plugin
		execution with plugin response and current request object.
	- `Plugin_Execution_After_StopProcessing` - boolean indicates the plugin
		execution status after currentRequest.stopProcessing is set.
- In the example snippet above, three parameters are passed to custom rethink
	module
	- `event` parameter passed by worker
	- `userBlocklistInfo` is output of _userOperation_ plugin
	- `dnsResolverResponse` is output of _dnsResolver_ plugin
- Once plugin execution is done `customCallBack` function is initiated with
	plugin `response` and `currentRequest`.
- Inside the plugin call-back based on the plugin response dns process can be
	stopped or moved further by saving response
	`this.registerParameter("parameter-name", parameter data)`.
- By setting `currentRequest.stopProcessing = true`, no further plugin will be
	executed except if _Plugin Execution After StopProcessing_ is set to true.
- Publish to cloudflare with updated plugin which will reflect to all your
	pointed devices.
