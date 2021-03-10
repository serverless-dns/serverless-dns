var SharedContext = require('@serverless-dns/globalcontext').SharedContext
var SingleRequest = require('@serverless-dns/single-request').SingleRequest
var Modules = require("@serverless-dns/free-user").Modules

addEventListener('fetch', event => {
	event.respondWith(handleRequest(event))
})

async function handleRequest(event) {
	return proxyRequest(event)
}


let commonContext = new SharedContext()

async function proxyRequest(event) {
	let thisRequest = new SingleRequest()
	let res
	try {
		if (event.request.method === "OPTIONS") {
			res = new Response()
			res.headers.set('Content-Type', 'application/json')
			res.headers.set('Access-Control-Allow-Origin', '*')
			res.headers.set('Access-Control-Allow-Headers', '*')
			return res
		}
		let Caller
		for (let i = 0; i <= Modules.length - 1; i++) {
			Caller = new Modules[i]()
			await Caller.RethinkModule(commonContext, thisRequest, event)
			if (thisRequest.StopProcessing) {
				if (thisRequest.IsException) {
					thisRequest.DnsExceptionResponse()
				}
				else if (thisRequest.IsInvalidFlagBlock == true) {
					thisRequest.CustomResponse("Invalid Flag", "User Invalid Flag Block")
				}
				break
			}
		}
	}
	catch (e) {
		//thisRequest.exception = e
		//thisRequest.DnsExceptionResponse()
		res = new Response(JSON.stringify(e.stack))
		res.headers.set('Content-Type', 'application/json')
		res.headers.set('Access-Control-Allow-Origin', '*')
		res.headers.set('Access-Control-Allow-Headers', '*')
		res.headers.append('Vary', 'Origin')
		res.headers.set('server', 'bravedns')
		res.headers.delete('expect-ct')
		res.headers.delete('cf-ray')
		return res
	}
	
	return thisRequest.httpResponse
}