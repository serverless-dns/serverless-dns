This is free, open source rethink serverless DOH resolver with custom blocklist
that can be hosted on cloudflare. This initiative is to provide first level of
anti-censorship and data privacy to every persons on earth.

## For People

### Hosting

- Rethink serverless can be hosted to cloudflare (user will be liable for
  cloudflare billing).
- click below button to deploy
  <br><br>
  [![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/serverless-dns/serverless-dns/)

### Configure

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

### Change Resolver

- By default dns request are resolved by cloudflare `cloudflare-dns.com`.
- To change resolver login to your cloudflare dash board
  - click on `worker`
  - click on `serverless-dns` worker
  - click on `Settings` tab
  - under `Environment Variables` click on `Edit variables`
  - if your new DOH resolver url is `example.dns.resolver.com/dns-query/resolve`
  - change below variables and click on save button<br>
    `CF_DNS_RESOLVER_URL = example.dns.resolver.com/dns-query/resolve`

## For Developers

### Flow

- The flow of rethink dns is based on plugin module, current
  [plugin flow](./plugin.js) is as below. Five plugins are currently loaded.
  1. [CommandControl](https://github.com/serverless-dns/command-control)<br>
     This is optional plugin used to provide command to rethink serverless dns
     using GET request.
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
     This is optional plugin used to check whether dns resolved response
     contains cname and cname has blocked domain name, if cname has blocked
     domain name then request is blocked.

### Custom Plugin

- Custom plugins can be developed by adding following function to class
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
  - Inside `RethinkModule` method your custom logic can be build for your
    rethink serverless dns.
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
    - `Plugin_Callback_Function` - function that will be called back after
      plugin execution with plugin response and current request object.
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
