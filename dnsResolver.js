/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

class DNSResolver {
    constructor() {
        this.dnsResolverUrl = CF_DNS_RESOLVER_URL
    }
    /*
    param.event
    param.userBlocklistInfo
    */
    async RethinkModule(param) {
        let response = {}
        response.isException = false
        response.exceptionStack = ""
        response.exceptionFrom = ""
        response.data = {}
        response.data.dnsResponse
        try {
            let res = await resolveDns(param.event.request, param.userBlocklistInfo.dnsResolverUrl)
            response.data.dnsResponse = new Response(res.body, res)
            response.data.dnsResponse.headers.set('Content-Type', 'application/dns-message')
            response.data.dnsResponse.headers.set('Access-Control-Allow-Origin', '*')
            response.data.dnsResponse.headers.set('Access-Control-Allow-Headers', '*')
            response.data.dnsResponse.headers.append('Vary', 'Origin')
            response.data.dnsResponse.headers.set('server', 'bravedns')
            response.data.dnsResponse.headers.delete('expect-ct')
            response.data.dnsResponse.headers.delete('cf-ray')
        }
        catch (e) {
            response.isException = true
            response.exceptionStack = e.stack
            response.exceptionFrom = "DNSResolver RethinkModule"
            response.data = false
        }
        return response
    }


}

async function resolveDns(request, resolverUrl) {
    try {
        return await forwardDnsMessage(request, resolverUrl)
    }
    catch (e) {
        throw e
    }
}

async function forwardDnsMessage(request, resolverUrl) {
    let u = new URL(request.url)
    let dnsResolverUrl = new URL(resolverUrl)
    u.hostname = dnsResolverUrl.hostname
    u.pathname = dnsResolverUrl.pathname

    let newRequest
    if (request.method === 'GET') {
        newRequest = new Request(u.href, {
            method: 'GET',
            headers: {
                'crossDomain': 'true',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'X-Requested-With, Content-Type, Authorization, Origin, Accept, Access-Control-Request-Method, Access-Control-Request-Headers',
                'Access-Control-Allow-Methods': 'POST, GET, PUT, OPTIONS, DELETE',
                'Content-Type': 'application/dns-message',
                'accept': 'application/dns-message'
            }
        })
    }
    else if (request.method === 'POST') {
        let buf = await request.arrayBuffer()
        newRequest = new Request(u.href, {
            method: 'POST',
            headers: {
                'crossDomain': 'true',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'X-Requested-With, Content-Type, Authorization, Origin, Accept, Access-Control-Request-Method, Access-Control-Request-Headers',
                'Access-Control-Allow-Methods': 'POST, GET, PUT, OPTIONS, DELETE',
                'Content-Type': 'application/dns-message',
                'accept': 'application/dns-message',
                'content-length': buf.byteLength
            },
            body: buf
        })
    }
    else {
        newRequest = new Request(u.href)
    }

    return await fetch(newRequest)
}

module.exports.DNSResolver = DNSResolver