This is a rethink plugin repository for rethink serverless dns.
1. Dns resolver plugin
    This plugin forwards dns request to upstream resolver which is configurable at worker's environment variable.
2. Dns block plugin
    This plugin checks for requested domain should be blocked or further process to upstream resolver.
3. Dns cname block plugin
    This plugin checks whether dns response from upstream resolver should be blocked or send back to user.