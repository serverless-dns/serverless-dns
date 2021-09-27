/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

class DNSResolver {
    constructor() {
    }
    /*
    param.request
    param.requestBodyBuffer
    param.dnsResolverUrl
    */
    async RethinkModule(param) {
        let response = {}
        response.isException = false
        response.exceptionStack = ""
        response.exceptionFrom = ""
        response.data = {}
        response.data.dnsResponse
        try {
            response.data.responseBodyBuffer = await (await resolveDns(param.request, param.dnsResolverUrl, param.requestBodyBuffer)).arrayBuffer()
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

async function resolveDns(request, resolverUrl, requestBodyBuffer) {
    try {
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
            newRequest = new Request(u.href, {
                method: 'POST',
                headers: {
                    'crossDomain': 'true',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'X-Requested-With, Content-Type, Authorization, Origin, Accept, Access-Control-Request-Method, Access-Control-Request-Headers',
                    'Access-Control-Allow-Methods': 'POST, GET, PUT, OPTIONS, DELETE',
                    'Content-Type': 'application/dns-message',
                    'accept': 'application/dns-message',
                    'content-length': requestBodyBuffer.byteLength
                },
                body: requestBodyBuffer
            })
        }
        else {
            newRequest = new Request(u.href)
        }

        return await fetch(newRequest)
    }
    catch (e) {
        throw e
    }
}

module.exports.DNSResolver = DNSResolver