This is free, open source rethink serverless DOH resolver with custom blocklist
that can be hosted on cloudflare. This initiative is to provide first level of
anti-censorship and data privacy to every persons on earth.

1. #### Hosting
   - Rethink serverless can be hosted to cloudflare (user will be liable for
     cloudflare billing, free for first 100k requests per day, service will be disabled until the next day unless upgrading to paid tier).
   - click below button to deploy
     <br><br>
     [![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/serverless-dns/serverless-dns/)
2. #### Configure
   - Once the hosting is successful, lets consider rethink serverless dns is
     hosted to example.com.
   - To configure your dns level blocking visit to example.com/configure which
     will take to configuration page, which currently contains 171 blocklists
     with 5Million too block domains in category like notracking, dating,
     gambling, privacy, porn, cryptojacking, security ...
   - Navigate through and select your blocklists.
   - Once selected you can find your domain name 'example.com' followed by
     configuration token on screen like this 'https://example.com/1:AIAA7g=='
     copy it and add to your dns DOH client.
   - Now your own trusted dns resolver with custom blocking is up and running.
3. #### Change Resolver
   - By default dns request are resolved by cloudflare 'cloudflare-dns.com'.
   - To change resolver login to your cloudflare dash board
     - click on worker
     - click on serverless-dns worker
     - click on 'Settings' tab
     - under 'Environment Variables' click on 'Edit variables'
     - if your new DOH resolver url is
       'example.dns.resolver.com/dns-query/resolve'
     - change below variables and click on save button CF_DNS_RESOLVER_URL =
       example.dns.resolver.com/dns-query/resolve

4. For Developers
   - Flow <br> &emsp;The flow of rethink dns is based on plugin module, current
     [plugin flow](https://github.com/serverless-dns/serverless-dns/blob/main/plugin.js#L19)
     as below
     ```javascript
     this.registerPlugin(
       "commandControl",
       commandControl,
       ["event", "blocklistFilter"],
       commandControlCallBack,
       false,
     );
     this.registerPlugin(
       "userOperation",
       userOperation,
       ["event", "blocklistFilter"],
       userOperationCallBack,
       false,
     );
     this.registerPlugin(
       "dnsBlock",
       dnsBlock,
       ["event", "blocklistFilter", "userBlocklistInfo"],
       dnsBlockCallBack,
       false,
     );
     this.registerPlugin(
       "dnsResolver",
       dnsResolver,
       ["event", "userBlocklistInfo"],
       dnsResolverCallBack,
       false,
     );
     this.registerPlugin(
       "dnsCnameBlock",
       dnsCnameBlock,
       ["event", "userBlocklistInfo", "blocklistFilter", "dnsResolverResponse"],
       dnsCnameBlockCallBack,
       false,
     );
     ```
     There are 5 plugins currently loaded by rethink dns.
     - [CommandControl](https://github.com/serverless-dns/command-control)<br>
       This is optional plugin used to provide command to rethink serverless dns
       using GET request.
     - [UserOperation](https://github.com/serverless-dns/basic)<br> This plugin
       loads current user details if not found in cache.<br> eg. dns resolve
       'google.com' request to rethink serverless cloudflare resolver
       'https://example.com/1:AIAA7g==' configuration string '1:AIAA7g==' is
       treated as user id and loads selected blocklists files for configuration
       string and cache it under user id.
     - [DNSBlock](https://github.com/serverless-dns/dns-blocker/blob/main/dnsBlock.js)<br>
       This is optional plugin used to check whether requested domain should be
       blocked or processed further.
     - [DNSResolver](https://github.com/serverless-dns/dns-blocker/blob/main/dnsResolver.js)<br>
       This plugin forward dns request to upstream resolver based on environment
       variable 'CF_DNS_RESOLVER_URL' if not blocked by DNSBlock plugin.
     - [DNSCnameBlock](https://github.com/serverless-dns/dns-blocker/blob/main/dnsCnameBlock.js)<br>
       This is optional plugin used to check whether dns resolved response
       contains cname and cname has blocked domain name, if cname has blocked
       domain name then request is blocked.

   - Custom Plugin<br> Custom plugins can be developed by adding following
     function to class
     ```javascript
     class CustomPlugin {
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
     module.exports.CustomPlugin = CustomPlugin;
     ```
     - RethinkModule(param) is entry point for every plugin.<br>
     - Inside RethinkModule method your custom logic can be build for your
       rethink serverless dns.<br>
     - example if published to npm as @your-plugin/plugin<br>
     - add your plugin to rethink serverless dns at
       [plugin.js](https://github.com/serverless-dns/serverless-dns/blob/main/plugin.js)
     ```javascript
     import { CommandControl } from "@serverless-dns/command-control";
     import { UserOperation } from "@serverless-dns/basic";
     import { DNSBlock } from "@serverless-dns/dns-operation";
     import { DNSResolver } from "@serverless-dns/dns-operation";
     import { DNSCnameBlock } from "@serverless-dns/dns-operation";

     const commandControl = new CommandControl();
     const userOperation = new UserOperation();
     const dnsBlock = new DNSBlock();
     const dnsResolver = new DNSResolver();
     const dnsCnameBlock = new DNSCnameBlock();

     //customPlugin declaration
     import { CustomPlugin } from "@your-plugin/plugin";
     const customPlugin = new CustomPlugin();
     //

     this.registerPlugin(
       "commandControl",
       commandControl,
       ["event", "blocklistFilter"],
       commandControlCallBack,
       false,
     );
     this.registerPlugin(
       "userOperation",
       userOperation,
       ["event", "blocklistFilter"],
       userOperationCallBack,
       false,
     );
     this.registerPlugin(
       "dnsBlock",
       dnsBlock,
       ["event", "blocklistFilter", "userBlocklistInfo"],
       dnsBlockCallBack,
       false,
     );
     this.registerPlugin(
       "dnsResolver",
       dnsResolver,
       ["event", "userBlocklistInfo"],
       dnsResolverCallBack,
       false,
     );

     //custom plugin registration
     this.registerPlugin(
       "customPlugin",
       customPlugin,
       ["event", "userBlocklistInfo", "dnsResolverResponse"],
       customCallBack,
       false,
     );
     //

     this.registerPlugin(
       "dnsCnameBlock",
       dnsCnameBlock,
       ["event", "userBlocklistInfo", "blocklistFilter", "dnsResolverResponse"],
       dnsCnameBlockCallBack,
       false,
     );

     //custom plugin call back after execution
     function customCallBack(response, currentRequest) {
       if (response.isException) {
         loadException(response, currentRequest);
       } else if (response.data.decision) {
         currentRequest.stopProcessing = true;
       } else {
         //this.registerParameter("parameter-name", parameter data) -> parameter-name can be used to pass as parameter for next plugin
         this.registerParameter("customResponse", response.data);
       }
     }
     ```
     - this.registerPlugin( Plugin Name, Plugin Object , [Parameter to Plugin],
       Plugin Call Back Function, Plugin Execution After StopProcessing)<br>
       - Plugin Name - string denotes name of the plugin. <br>
       - Plugin Object - object of plugin class, which implements RethinkModule
         function within class. <br>
       - Parameter to Plugin - list of parameters passed to RethinkModule
         function. <br>
       - Plugin Call Back Function - function that will be called back after
         plugin execution with plugin response and current request object. <br>
       - Plugin Execution After StopProcessing - boolean indicates the plugin
         execution status after currentRequest.stopProcessing is set.<br>

     - In above example custom created plugin will executed after dnsResolver
       plugin.<br>
     - Three parameters are passed to custom rethink module<br>
       - event parameter passed by worker<br>
       - userBlocklistInfo is output of userOperation plugin<br>
       - dnsResolverResponse is output of dnsResolver plugin<br>
     - Once plugin execution is done customCallBack function is initiated with
       plugin response and currentRequest.
     - Inside the plugin call-back based on the plugin response dns process can
       be stopped or moved further by saving response
       this.registerParameter("parameter-name", parameter data).
     - By setting currentRequest.stopProcessing = true, no further plugin will
       be executed except if 'Plugin Execution After StopProcessing' is set to
       true.
     - Publish to cloudflare with updated plugin which will reflect to all your
       pointed devices.
