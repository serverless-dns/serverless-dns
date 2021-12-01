This is free, open source RethinkDNS serverless DoH and DoT resolvers with custom blocklists
that can be hosted on cloudflare, fly.io and deno-deploy. This initiative is to provide first level of
anti-censorship and data privacy to every person on the earth.

## For the People

### Using Cloudflare

> Difficulty: Easy

> Supports DoH resolver only

1. #### Hosting
	- Rethink serverless can be hosted to cloudflare (user will be liable for
		cloudflare billing).
	- click below button to deploy
		<br><br>
		[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/serverless-dns/serverless-dns/)
2. #### Configure
	- Once the hosting is successful, lets consider rethink serverless dns is hosted
		to `example.com`.
	- To configure your dns level blocking visit to `example.com/configure` which
		will take to configuration page, which currently contains 171 blocklists with
		5 Million too block domains in category like notracking, dating, gambling,
		privacy, porn, cryptojacking, security ...
	- Navigate through and select your blocklists.
	- Once selected you can find your domain name `example.com` followed by
		configuration token on screen like this `https://example.com/1:AIAA7g==` copy
		it and add to your dns DOH client.
	- Now your own trusted dns resolver with custom blocking is up and running.
3. #### Change Resolver
	- By default dns request are resolved by cloudflare `cloudflare-dns.com`.
	- To change resolver login to your cloudflare dash board
		- click on `worker`
		- click on `serverless-dns` worker
		- click on `Settings` tab
		- under `Environment Variables` click on `Edit variables`
		- if your new DOH resolver url is `example.dns.resolver.com/dns-query/resolve`
		- change below variables and click on save button<br>
			`CF_DNS_RESOLVER_URL = example.dns.resolver.com/dns-query/resolve`

### Using Deno-Deploy

> Difficulty: Moderate

> Supports DoH resolver only

> User will be liable for fly.io billing

1. Fork [this repository](https://github.com/serverless-dns/serverless-dns) (You will need a GitHub account).
2. In your fork, click on the _Actions_ tab and Confirm that you want to use Actions, if asked.
3. Click on "🦕 Deno deploy" on the left pane. Click on the "Run workflow" dropdown on the right side, and run the workflow using the <kbd>Run workflow</kbd> button.
4. Now, navigate to [deno.com/deploy](https://deno.com/deploy) and Sign Up for an account.
5. Create a new project in [deno deploy dash](https://dash.deno.com). Name it appropriately.
6. Click on "Continue" button under "Deploy from GitHub" and proceed to install the GitHub app on your GitHub Account. Make sure you give access the fork you had made in step 1.
7. Now, head back the deno dash and select the repository as the fork you had made in step 1 for integration. And branch as "build/deno-deploy/dev". And select the file as "http.bundle.js".
8. In this deno project, navigate to Settings -> Environment variables. Add the essential environment variables as described [`.env.example`](.env.example) file. Values of the required variables can be inferred from [`wrangler.toml`](wrangler.toml) and [`fly.toml`](fly.toml) files.
9. Done. Now your DoH resolver should be available on `https://<name>.deno.dev`, where `<name>` is the name of the project you had created on step 5.

### Using Fly.io

> Difficulty: Hard

> Supports both DoH and DoT resolver

> User will be liable for fly.io billing

1. Install `flyctl` on your device. Please [refer to fly.io docs](https://fly.io/docs/getting-started/installing-flyctl/) for the same.
2. Signup or Login to fly.io. Please [refer to fly.io docs](https://fly.io/docs/getting-started/login-to-fly/) for the same.
3. Create an empty directory anywhere on your PC. Open you terminal or powershell and navigate to this directory.
4. Launch a fly app
	```sh
	flyctl launch
	```
	- Choose a unique name here or let it auto-generate.
	- Choose a location (closest to you would be better for you to use).
	- Note down the name of the app and you may delete this directory along with the generated `fly.toml`.
5. Now, you would need a SSL or TLS certificate for your domain name. Both getting a domain name and CA certificate generation are beyond the scope of this README.
6. Once you have your CA certificate and key files, you need to encode them as base64 with no wrapping. How this can be done in bash terminal is shown below.
	```sh
	# Locate your CA certificate & key files
	CRT="path/to/full-chain-certificate.pem"
	KEY="path/to/key.pem"
	```
	```sh
	# Encode them in base64 with no wrappings and store them in variables
	B64NOWRAP_KEY="$(base64 -w0 "$KEY")"
	B64NOWRAP_CRT="$(base64 -w0 "$CRT")"
	```
7. As described in [`.env.example`](.env.example) file, this base64 encoded certificate-key pair need to set as a single environment variable called `TLS_`. Within this variable, the certificate and key encodings needs to be separated by a newline (`\n`) and described by `CRT=` and `KEY=`. On a bash terminal this can be done by following steps continued by by above.
	```sh
	# This creates a single file called "FLY_TLS" in the current directory
	echo "KEY=$B64NOWRAP_KEY" > FLY_TLS
	echo "CRT=$B64NOWRAP_CRT" >> FLY_TLS
	# And now, this "FLY_TLS" file contains both certificate and key encoded and
	# as required
	```
	- Upload this to fly secrets like so in terminal or powershell:
		```sh
		fly secrets set TLS_=- < FLY_TLS -a app-id
		```
		where "app-id" is the name of the fly app you had launched in step 4.
	- Other essential environment variables are already present in [`fly.toml`](fly.toml) file of this repository, but you may read [`.env.example`](.env.example) for it's use case and configuration.
8. Fork [this repository](https://github.com/serverless-dns/serverless-dns) (You will need a GitHub account).
9. In your fork, click on the _Actions_ tab and Confirm that you want to use Actions, if asked.
10. Similarly, click on _Settings_ tab and select _Secrets_ on the left pane. Add a new GitHub secret called **FLY_APP_NAME** and set it's value as the name of the fly app you had launched in step 4. And add another secret called **FLY_API_TOKEN** and set's value as what you get from running `flyctl auth token` in terminal or powershell.
11. Head back to _Actions_ tab and click on "🪰 Fly" on the left pane. Click on the "Run workflow" dropdown on the right side, and run the workflow using the <kbd>Run workflow</kbd> button.
12. Once this action workflow finishes, open the terminal or powershell again and type in:
	```sh
	flyctl ips list -a [app-id]
	```
	- Here, you can get the IP address of the application, update the DNS records of your domain name you had used in step 5.
13. Done. Your application should be available on the said domain name in a few minutes. To configure, say, to change the upstream resolver, you can edit the environment variables on `fly.toml` file of your fork and re-run the Action workflow.

## For the Developers

### Deno

Run:

```
deno run --allow-net --allow-env --allow-read --import-map=import_map.json http.ts
```

List of environment variables can be found in [`.env.example`](.env.example)
file. Load them as required. For convenience, you can also put them in a `.env`
file and they will also be loaded into the environment.

### Node

Run:

```
node server.js
```

Proxies DNS over HTTPS & DNS over TLS requests to the main app (`index.js`).

List of environment variables can be found in [`.env.example`](.env.example)
file. Load them as required. For convenience in non-production environment, you
can also put them in a `.env` file and they will be loaded into the environment
if not already present.

### Flow

The flow of rethink dns is based on plugin module, current
[plugin flow](./plugin.js) is as below. Five plugins are currently loaded.

1. [CommandControl](https://github.com/serverless-dns/command-control)<br> This
	 is optional plugin used to provide command to rethink serverless dns using
	 GET request.
2. [UserOperation](https://github.com/serverless-dns/basic)<br> This plugin
	 loads current user details if not found in cache.<br> e.g. dns resolve
	 `google.com` request to rethink serverless cloudflare resolver
	 `https://example.com/1:AIAA7g==`, configuration string `1:AIAA7g==` is
	 treated as user id and loads selected blocklists files for configuration
	 string and cache it under user id.
3. [DNSBlock](https://github.com/serverless-dns/dns-blocker/blob/main/dnsBlock.js)<br>
	 This is optional plugin used to check whether requested domain should be
	 blocked or processed further.
4. [DNSResolver](https://github.com/serverless-dns/dns-blocker/blob/main/dnsResolver.js)<br>
	 This plugin forward dns request to upstream resolver based on environment
	 variable `CF_DNS_RESOLVER_URL` if not blocked by DNSBlock plugin.
5. [DNSCnameBlock](https://github.com/serverless-dns/dns-blocker/blob/main/dnsCnameBlock.js)<br>
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
- add your plugin to rethink serverless dns at [plugin.js](./plugin.js)

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
