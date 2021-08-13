/*
 * Copyright (c) 2021 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

var DnsParser = require("@serverless-dns/dns-operation").DNSParserWrap
class CurrentRequest {
	constructor() {
		this.blockedB64Flag = ""
		this.decodedDnsPacket = undefined
		this.httpResponse = undefined
		this.isException = false
		this.exceptionStack = undefined
		this.exceptionFrom = ""
		this.isDnsParseException = false
		this.isDnsBlock = false
		this.isDomainInBlockListNotBlocked = false
		this.isInvalidFlagBlock = false
		this.stopProcessing = false
		this.dnsParser = new DnsParser()
	}

	dnsExceptionResponse() {
		let singleLog = {}
		singleLog.exceptionFrom = this.exceptionFrom
		singleLog.exceptionStack = this.exceptionStack
		let dnsEncodeObj = this.dnsParser.Encode({
			type: 'response',
			flags: 1
		});
		let res = new Response(dnsEncodeObj)
		this.httpResponse = new Response(res.body, res)
		this.httpResponse.headers.set('x-err', JSON.stringify(singleLog))
		this.httpResponse.headers.set('Content-Type', 'application/dns-message')
		this.httpResponse.headers.set('Access-Control-Allow-Origin', '*')
		this.httpResponse.headers.set('Access-Control-Allow-Headers', '*')
		this.httpResponse.headers.append('Vary', 'Origin')
		this.httpResponse.headers.set('server', 'bravedns')
		this.httpResponse.headers.delete('expect-ct')
		this.httpResponse.headers.delete('cf-ray')
	}

	customResponse(data) {
		let dnsEncodeObj = this.dnsParser.Encode({
			type: 'response',
			flags: 1
		});
		let res = new Response(dnsEncodeObj)
		this.httpResponse = new Response(res.body, res)
		this.httpResponse.headers.set('x-err', JSON.stringify(data))
		this.httpResponse.headers.set('Content-Type', 'application/dns-message')
		this.httpResponse.headers.set('Access-Control-Allow-Origin', '*')
		this.httpResponse.headers.set('Access-Control-Allow-Headers', '*')
		this.httpResponse.headers.append('Vary', 'Origin')
		this.httpResponse.headers.set('server', 'bravedns')
		this.httpResponse.headers.delete('expect-ct')
		this.httpResponse.headers.delete('cf-ray')
	}

	dnsResponse() {
		if (this.isDomainInBlockListNotBlocked) {
			this.httpResponse = new Response(this.httpResponse.body, this.httpResponse)
			this.httpResponse.headers.set('x-nile-flag-notblocked', this.blockedB64Flag)
		}
		return this.httpResponse
	}
	dnsBlockResponse() {
		try {
			this.decodedDnsPacket.type = "response";
			this.decodedDnsPacket.rcode = "NOERROR";
			this.decodedDnsPacket.flags = 384
			this.decodedDnsPacket.flag_qr = true;
			this.decodedDnsPacket.answers = [];
			this.decodedDnsPacket.answers[0] = {}
			this.decodedDnsPacket.answers[0].name = this.decodedDnsPacket.questions[0].name
			this.decodedDnsPacket.answers[0].type = this.decodedDnsPacket.questions[0].type
			this.decodedDnsPacket.answers[0].ttl = 300
			this.decodedDnsPacket.answers[0].class = "IN"
			this.decodedDnsPacket.answers[0].data = "0.0.0.0"
			this.decodedDnsPacket.answers[0].flush = false
			if (this.decodedDnsPacket.questions[0].type == "A") {
				this.decodedDnsPacket.answers[0].data = "0.0.0.0"
			}
			else {
				this.decodedDnsPacket.answers[0].data = "::"
			}
			let res = new Response(this.dnsParser.Encode(this.decodedDnsPacket))
			this.httpResponse = new Response(res.body, res)
			this.httpResponse.headers.set('Content-Type', 'application/dns-message')
			this.httpResponse.headers.set('Access-Control-Allow-Origin', '*')
			this.httpResponse.headers.set('Access-Control-Allow-Headers', '*')
			this.httpResponse.headers.append('Vary', 'Origin')
			this.httpResponse.headers.set('server', 'bravedns')
			this.httpResponse.headers.delete('expect-ct')
			this.httpResponse.headers.delete('cf-ray')
			this.httpResponse.headers.set('x-nile-flags', this.blockedB64Flag)
		}
		catch (e) {
			this.isException = true
			this.exceptionStack = e.stack
			this.exceptionFrom = "SingleRequest.js SingleRequest DnsBlockResponse"
		}
	}
}
module.exports.CurrentRequest = CurrentRequest