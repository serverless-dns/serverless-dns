###Rethink Serverless Dns Resolver
This is free, open source rethink serverless DOH dns resolver with custom blocklist that can be hosted on cloudflare. This initiative is to provide first level of anti-censorship and data privacy to every persons on earth.
1. Hosting
    * Rethink serverless can be hosted to cloudflare(user will be liable for cloudflare billing).
    * click below button to deploy
            [![Deploy Rethink Dns to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/serverless-dns/serverless-dns)
2. Configure
    * Once the hosting is successful, lets consider rethink serverless dns is hosted to example.com.
    * To configure your dns level blocking vist to example.com/configure which will take to configuration page, which currently contains 171 blocklists with 5Million too block domains in catogery like notracking, dating, gambling, privacy, porn, cryptojacking, security ...
    * Navigate through and select your blocklists.
    * Once selected you can find your domain name 'example.com' followed by configuration token on screen like this 'https://example.com/1:AIAA7g==' copy it and add to your dns DOH client.
    * Now your own trusted dns resolver with custom blocking is up and running.
3. Change Resolver
    * By default dns request are resolved by cloudflare 'cloudflare-dns.com'.
    * To change resolver login to your cloudflare dash board
        * click on worker
        * click on serverless-dns worker
        * click on 'Setttings' tab
        * under 'Environment Variables' click on 'Edit variables'
        * if your new DOH resolver url is 'example.dns.resolver.com/dns-query/resolve'
        * change below variables and click on save button
            CF_DNS_RESOLVER_DOMAIN_NAME = example.dns.resolver.com
            Cf_DNS_RESOLVER_PATH_NAME = dns-query/resolve
4. For Developers
    * Flow
        The flow of rethink dns is based on plugin module, current [free user flow](https://github.com/serverless-dns/free-user) is below
        ```javascript
            var Modules = []
            Modules[0] = require('@serverless-dns/globalcontext').SharedContext
            Modules[1] = require('@serverless-dns/command-control').CommandControl
            Modules[2] = require('@serverless-dns/single-request').SingleRequest
            Modules[3] = require("./UserOperation.js").UserOperation
            Modules[4] = require('@serverless-dns/dns-blocker').DNSBlock
            Modules[5] = require('@serverless-dns/dns-blocker').DNSResolver
            Modules[6] = require('@serverless-dns/dns-blocker').DNSCnameBlock
            Modules[7] =  require('./UserLog.js').Log
        ``` 
        There are 8 plugins currently loaded by rethink dns out of which SharedContext, SingleRequest, UserOperation, DNSResolver are mandatory plugins.
        * [SharedContext](https://github.com/serverless-dns/globalcontext)
            This plugin loads all global variables and methods once and used accross all plugins for multiple dns requestes.
            Loads environment variable.
            Initialize local cache.
            Downloads blocklist filter from aws s3.
        * [CommandControl](https://github.com/serverless-dns/command-control)
            This is optional plugin used to provide command to rethink serverless dns using GET request.
        * [SingleRequest](https://github.com/serverless-dns/single-request)
            This plugin loads requested domain name, user details from cache if exist.
            Check requested domain name exists in blocklist and cache domain name if not exist in cache. 
        * [UserOperation](https://github.com/serverless-dns/free-user)
            This plugin loads current user details if not found in cache.
            eg. dns resolve 'google.com' request to rethink serverless cloudflare resolver 'https://example.com/1:AIAA7g==' configuration string '1:AIAA7g==' is treated as user id and loads selected blocklists files for configuration string and cache it under user id.
        * [DNSBlock](https://github.com/serverless-dns/dns-blocker)
            This is optional plugin used to check whether requested domain should be blocked or processed further.            
        * [DNSResolver](https://github.com/serverless-dns/dns-blocker)
            This plugin forward dns request to upstream resolver based on environment variable 'CF_DNS_RESOLVER_DOMAIN_NAME' & Cf_DNS_RESOLVER_PATH_NAME if not blocked by DNSBlock plugin.
        * [DNSCnameBlock](https://github.com/serverless-dns/dns-blocker)
            This is optional plugin used to check whether dns resolved response contains cname and cname has blocked domain name, if cname has blocked domain name then request is blocked.
        * [Log](https://github.com/serverless-dns/free-user)
            This is optional plugin used to collect logs about all dns request, stored logs will be processed based on configurable wait time at environment variable CF_DNSLOG_WAIT_TIME as milliseconds, currently its 10000 milliseconds. Normal cloudflare plan can wait upto 30seconds set accordingly.
            This plugin is partially developed till log collection,
            Further can implement it to pass dns logs to their personal data stores for thread analytics or usage analytics and further more.
    * Custom Plugin
        Custom plugins can be developed by adding following function to class
        ```javascript
            class CustomPlugin {
                constructor() {

                }
                async RethinkModule(commonContext, thisRequest, event) {
                    try{

                    }
                    catch(e){
                        thisRequest.StopProcessing = true
                        thisRequest.IsException = true
                        thisRequest.exception = e
                        thisRequest.exceptionFrom = "CustomPlugin.js CustomPlugin"
                    }
                }
            }
            module.exports.CustomPlugin = CustomPlugin
        ```
        RethinkModule(commonContext, thisRequest, event) is entry point for every plugin.
        Inside RethinkModule method your custom logic can be build for your dns resolver.
        Three parameters are passed to RethinkModule where 
            commonContext contains all global information.
            thisRequest contains details about current request.
            event is worker parameter passed for the current request.
        To stop execution of plugins set thisRequest.StopProcessing = true and return, no further plugins will be executed.
        By stop processing we have interruped process, make sure you generate proper return response.
        Once your custom plugin is created publish it to npm or directly point it to module file.
        Make sure Modules array index is incremented properly.
        example if published to npm as @your-plugin/plugin
        ```javascript
            var Modules = []
            Modules[0] = require('@serverless-dns/globalcontext').SharedContext
            Modules[1] = require('@serverless-dns/command-control').CommandControl
            Modules[2] = require('@serverless-dns/single-request').SingleRequest
            Modules[3] = require("./UserOperation.js").UserOperation
            Modules[4] = require('@serverless-dns/dns-blocker').DNSBlock
            Modules[5] = require('@serverless-dns/dns-blocker').DNSResolver
            Modules[6] = require('@serverless-dns/dns-blocker').DNSCnameBlock
            Modules[7] = require('@your-plugin/plugin').CustomPlugin
            Modules[8] =  require('./UserLog.js').Log
        ``` 
        in above example custom created plugin will executed after DNSCnameBlock plugin.
        Publish to cloudflare with updated plugin which will reflect to all your pointed devices.