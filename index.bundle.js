// deno-fmt-ignore-file
// deno-lint-ignore-file
// This code was bundled using `deno bundle` and it's not recommended to edit it manually

function removeEmptyValues(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, value])=>{
        if (value === null) return false;
        if (value === undefined) return false;
        if (value === "") return false;
        return true;
    }));
}
function difference(arrA, arrB) {
    return arrA.filter((a)=>arrB.indexOf(a) < 0
    );
}
function parse(rawDotenv) {
    const env = {};
    for (const line of rawDotenv.split("\n")){
        if (!isVariableStart(line)) continue;
        const key = line.slice(0, line.indexOf("=")).trim();
        let value = line.slice(line.indexOf("=") + 1).trim();
        if (hasSingleQuotes(value)) {
            value = value.slice(1, -1);
        } else if (hasDoubleQuotes(value)) {
            value = value.slice(1, -1);
            value = expandNewlines(value);
        } else value = value.trim();
        env[key] = value;
    }
    return env;
}
function config(options = {}) {
    const o = Object.assign({
        path: `.env`,
        export: false,
        safe: false,
        example: `.env.example`,
        allowEmptyValues: false,
        defaults: `.env.defaults`
    }, options);
    const conf = parseFile(o.path);
    if (o.defaults) {
        const confDefaults = parseFile(o.defaults);
        for(const key in confDefaults){
            if (!(key in conf)) {
                conf[key] = confDefaults[key];
            }
        }
    }
    if (o.safe) {
        const confExample = parseFile(o.example);
        assertSafe(conf, confExample, o.allowEmptyValues);
    }
    if (o.export) {
        for(const key in conf){
            if (Deno.env.get(key) !== undefined) continue;
            Deno.env.set(key, conf[key]);
        }
    }
    return conf;
}
function parseFile(filepath) {
    try {
        return parse(new TextDecoder("utf-8").decode(Deno.readFileSync(filepath)));
    } catch (e) {
        if (e instanceof Deno.errors.NotFound) return {};
        throw e;
    }
}
function isVariableStart(str) {
    return /^\s*[a-zA-Z_][a-zA-Z_0-9 ]*\s*=/.test(str);
}
function hasSingleQuotes(str) {
    return /^'([\s\S]*)'$/.test(str);
}
function hasDoubleQuotes(str) {
    return /^"([\s\S]*)"$/.test(str);
}
function expandNewlines(str) {
    return str.replaceAll("\\n", "\n");
}
function assertSafe(conf, confExample, allowEmptyValues) {
    const currentEnv = Deno.env.toObject();
    const confWithEnv = Object.assign({}, currentEnv, conf);
    const missing = difference(Object.keys(confExample), Object.keys(allowEmptyValues ? confWithEnv : removeEmptyValues(confWithEnv)));
    if (missing.length > 0) {
        const errorMessages = [
            `The following variables were defined in the example file but are not present in the environment:\n  ${missing.join(", ")}`,
            `Make sure to add them to your env file.`,
            !allowEmptyValues && `If you expect any of these variables to be empty, you can set the allowEmptyValues option to true.`, 
        ];
        throw new MissingEnvVarsError(errorMessages.filter(Boolean).join("\n\n"));
    }
}
class MissingEnvVarsError extends Error {
    constructor(message){
        super(message);
        this.name = "MissingEnvVarsError";
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
function fromBrowser(ua) {
    return ua && ua.startsWith("Mozilla/5.0");
}
function jsonHeaders() {
    return {
        "Content-Type": "application/json"
    };
}
function dnsHeaders() {
    return {
        "Accept": "application/dns-message",
        "Content-Type": "application/dns-message"
    };
}
function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    };
}
function contentLengthHeader(b) {
    const len = !b || !b.byteLength ? "0" : b.byteLength.toString();
    return {
        "Content-Length": len
    };
}
function concatHeaders(...args) {
    return concatObj(...args);
}
function rxidFromHeader(h) {
    if (!h || !h.get) return null;
    return h.get("x-rethinkdns-rxid");
}
function copyHeaders(request) {
    const headers = {};
    if (!request || !request.headers) return headers;
    request.headers.forEach((val, name1)=>{
        headers[name1] = val;
    });
    return headers;
}
function sleep(ms) {
    return new Promise((resolve, reject)=>{
        try {
            setTimeout(resolve, ms);
        } catch (e) {
            reject(e);
        }
    });
}
function objOf(map) {
    return map.entries ? Object.fromEntries(map) : {};
}
function timedSafeAsyncOp(promisedOp, ms, defaultOp) {
    return new Promise((resolve, reject)=>{
        let timedout = false;
        const defferedOp = ()=>{
            defaultOp().then((v)=>{
                resolve(v);
            }).catch((e)=>{
                reject(e);
            });
        };
        const tid = timeout(ms, ()=>{
            timedout = true;
            defferedOp();
        });
        promisedOp().then((out)=>{
            if (!timedout) {
                clearTimeout(tid);
                resolve(out);
            }
        }).catch((ignored)=>{
            if (!timedout) defferedOp();
        });
    });
}
function timeout(ms, callback) {
    if (typeof callback !== "function") return -1;
    return setTimeout(callback, ms);
}
function rand(min, max) {
    return Math.floor(Math.random() * (max - min)) + min;
}
function rolldice(sides = 6) {
    return rand(1, sides + 1);
}
function uid() {
    return (Math.random() + 1).toString(36).slice(1);
}
function xid() {
    const hi = vmid();
    const lo = uid();
    return hi + lo;
}
let _vmid = "0";
function vmid() {
    if (_vmid === "0") _vmid = uid().slice(1);
    return _vmid;
}
const taskboxPromise = {
    p: Promise.resolve()
};
function microtaskBox(fns, arg) {
    let enqueue = null;
    if (typeof queueMicrotask === "function") {
        enqueue = queueMicrotask;
    } else {
        enqueue = taskboxPromise.p.then.bind(taskboxPromise.p);
    }
    enqueue(()=>safeBox(fns, arg)
    );
}
function safeBox(fns, arg) {
    if (typeof fns === "function") {
        fns = [
            fns
        ];
    }
    const r = [];
    if (!isIterable(fns)) {
        return r;
    }
    for (const f of fns){
        if (typeof f !== "function") {
            r.push(null);
            continue;
        }
        try {
            r.push(f(arg));
        } catch (ignore) {
            r.push(null);
        }
    }
    return r;
}
function isDnsMsg(req) {
    return req.headers.get("Accept") === "application/dns-message" || req.headers.get("Content-Type") === "application/dns-message";
}
function emptyResponse() {
    return {
        isException: false,
        exceptionStack: "",
        exceptionFrom: "",
        data: {}
    };
}
function errResponse(id, err) {
    const st = emptyObj(err) || !err.stack ? "no-stacktrace" : err.stack;
    return {
        isException: true,
        exceptionStack: st,
        exceptionFrom: id,
        data: {}
    };
}
function emptyString(str) {
    if (!str) return true;
    if (typeof str !== "string") return false;
    return str.trim().length === 0;
}
function emptyArray(a) {
    if (!a) return true;
    if (typeof a !== "object") return false;
    return a.length <= 0;
}
function concatObj(...args) {
    return Object.assign(...args);
}
function emptyObj(x) {
    if (!x) return true;
    return Object.keys(x).length === 0 && Object.getPrototypeOf(x) === Object.prototype;
}
function emptyMap(m) {
    if (!m) return true;
    return m.size === 0;
}
function isIterable(obj) {
    if (obj == null) return false;
    return typeof obj[Symbol.iterator] === "function";
}
function respond204() {
    return new Response(null, {
        status: 204,
        headers: corsHeaders()
    });
}
function respond400() {
    return new Response(null, {
        status: 400,
        statusText: "Bad Request"
    });
}
function respond405() {
    return new Response(null, {
        status: 405,
        statusText: "Method Not Allowed"
    });
}
function respond503() {
    return new Response(null, {
        status: 503,
        headers: dnsHeaders()
    });
}
function logger(...tags) {
    if (!log) return null;
    return log.withTags(...tags);
}
function isPostRequest(req) {
    return req && !emptyString(req.method) && req.method.toUpperCase() === "POST";
}
function isGetRequest(req) {
    return req && !emptyString(req.method) && req.method.toUpperCase() === "GET";
}
function stub(...args) {
    return (...args)=>{};
}
const stickyEvents = new Set([
    "prepare",
    "ready",
    "go", 
]);
const events = new Set();
const listeners = new Map();
const waitGroup = new Map();
(()=>{
    for (const e of events){
        listeners.set(e, new Set());
        waitGroup.set(e, new Set());
    }
    for (const se of stickyEvents){
        listeners.set(se, new Set());
        waitGroup.set(se, new Set());
    }
})();
function pub(event, parcel = undefined) {
    awaiters(event, parcel);
    callbacks(event, parcel);
}
function sub(event, cb) {
    const eventCallbacks = listeners.get(event);
    if (!eventCallbacks) {
        if (stickyEvents.has(event)) {
            microtaskBox(cb);
            return true;
        }
        return false;
    }
    eventCallbacks.add(cb);
    return true;
}
function when(event, timeout1 = 0) {
    const wg = waitGroup.get(event);
    if (!wg) {
        if (stickyEvents.has(event)) {
            return Promise.resolve(event);
        }
        return Promise.reject(new Error(event + " missing"));
    }
    return new Promise((accept, reject)=>{
        const tid = timeout1 > 0 ? timeout(timeout1, ()=>{
            reject(new Error(event + " elapsed " + timeout1));
        }) : -2;
        const fulfiller = function(parcel) {
            if (tid >= 0) clearTimeout(tid);
            accept(parcel, event);
        };
        wg.add(fulfiller);
    });
}
function awaiters(event, parcel) {
    const g = waitGroup.get(event);
    if (!g) return;
    if (stickyEvents.has(event)) {
        waitGroup.delete(event);
    }
    safeBox(g, parcel);
}
function callbacks(event, parcel) {
    const cbs = listeners.get(event);
    if (!cbs) return;
    if (stickyEvents.has(event)) {
        listeners.delete(event);
    }
    microtaskBox(cbs, parcel);
}
const _LOG_LEVELS = new Set([
    "error",
    "warn",
    "info",
    "timer",
    "debug"
]);
function _setConsoleLevel(level) {
    switch(level){
        case "error":
            globalThis.console.warn = stub();
        case "warn":
            globalThis.console.info = stub();
        case "info":
            globalThis.console.time = stub();
            globalThis.console.timeEnd = stub();
            globalThis.console.timeLog = stub();
        case "timer":
            globalThis.console.debug = stub();
        case "debug":
            break;
        default:
            console.error("Unknown console level: ", level);
            level = null;
    }
    if (level) {
        console.log("Console level set: ", level);
        globalThis.console.level = level;
    }
    return level;
}
class Log {
    constructor({ level ="debug" , levelize =false , withTimestamps =false  }){
        if (!_LOG_LEVELS.has(level)) level = "debug";
        if (levelize && !console.level) _setConsoleLevel(level);
        this.l = console.log;
        this.log = console.log;
        this.logTimestamps = withTimestamps;
        this.setLevel(level);
    }
    _resetLevel() {
        this.d = stub();
        this.debug = stub();
        this.lapTime = stub();
        this.startTime = stub();
        this.endTime = stub();
        this.i = stub();
        this.info = stub();
        this.w = stub();
        this.warn = stub();
        this.e = stub();
        this.error = stub();
    }
    withTags(...tags) {
        const that = this;
        return {
            lapTime: (n, ...r)=>{
                return that.lapTime(n, ...tags, ...r);
            },
            startTime: (n, ...r)=>{
                const tid = that.startTime(n);
                that.d(that.now() + " T", ...tags, "create", tid, ...r);
                return tid;
            },
            endTime: (n, ...r)=>{
                that.d(that.now() + " T", ...tags, "end", n, ...r);
                return that.endTime(n);
            },
            d: (...args)=>{
                that.d(that.now() + " D", ...tags, ...args);
            },
            i: (...args)=>{
                that.i(that.now() + " I", ...tags, ...args);
            },
            w: (...args)=>{
                that.w(that.now() + " W", ...tags, ...args);
            },
            e: (...args)=>{
                that.e(that.now() + " E", ...tags, ...args);
            },
            q: (...args)=>{
                that.l(that.now() + " Q", ...tags, ...args);
            },
            qStart: (...args)=>{
                that.l(that.now() + " Q", ...tags, that.border());
                that.l(that.now() + " Q", ...tags, ...args);
            },
            qEnd: (...args)=>{
                that.l(that.now() + " Q", ...tags, ...args);
                that.l(that.now() + " Q", ...tags, that.border());
            },
            tag: (t)=>{
                tags.push(t);
            }
        };
    }
    now() {
        if (this.logTimestamps) return new Date().toISOString();
        else return "";
    }
    border() {
        return "-------------------------------";
    }
    setLevel(level) {
        if (!_LOG_LEVELS.has(level)) throw new Error(`Unknown log level: ${level}`);
        this._resetLevel();
        switch(level){
            default:
            case "debug":
                this.d = console.debug;
                this.debug = console.debug;
            case "timer":
                this.lapTime = console.timeLog;
                this.startTime = function(name2) {
                    name2 += uid();
                    console.time(name2);
                    return name2;
                };
                this.endTime = console.timeEnd;
            case "info":
                this.i = console.info;
                this.info = console.info;
            case "warn":
                this.w = console.warn;
                this.warn = console.warn;
            case "error":
                this.e = console.error;
                this.error = console.error;
        }
        this.level = level;
    }
}
const defaults = {
    RUNTIME: {
        type: "string",
        default: _determineRuntime()
    },
    WORKER_ENV: {
        type: "string",
        default: "development"
    },
    DENO_ENV: {
        type: "string",
        default: "development"
    },
    NODE_ENV: {
        type: "string",
        default: "development"
    },
    CLOUD_PLATFORM: {
        type: "string",
        default: "local"
    },
    TLS_KEY_PATH: {
        type: "string",
        default: "test/data/tls/dns.rethinkdns.localhost.key"
    },
    TLS_CRT_PATH: {
        type: "string",
        default: "test/data/tls/dns.rethinkdns.localhost.crt"
    },
    LOG_LEVEL: {
        type: "string",
        default: "debug"
    },
    CF_BLOCKLIST_URL: {
        type: "string",
        default: "https://dist.rethinkdns.com/blocklists/"
    },
    CF_LATEST_BLOCKLIST_TIMESTAMP: {
        type: "string",
        default: "1638959365361"
    },
    CF_DNS_RESOLVER_URL: {
        type: "string",
        default: "https://cloudflare-dns.com/dns-query"
    },
    CF_DNS_RESOLVER_URL_2: {
        type: "string",
        default: "https://dns.google/dns-query"
    },
    WORKER_TIMEOUT: {
        type: "number",
        default: "10000"
    },
    CF_BLOCKLIST_DOWNLOAD_TIMEOUT: {
        type: "number",
        default: "5000"
    },
    TD_NODE_COUNT: {
        type: "number",
        default: "42112224"
    },
    TD_PARTS: {
        type: "number",
        default: "2"
    },
    CACHE_TTL: {
        type: "number",
        default: "1800"
    },
    DISABLE_BLOCKLISTS: {
        type: "boolean",
        default: false
    },
    PROFILE_DNS_RESOLVES: {
        type: "boolean",
        default: false
    },
    NODE_AVOID_FETCH: {
        type: "boolean",
        default: true
    },
    NODE_DOH_ONLY: {
        type: "boolean",
        default: false
    }
};
function caststr(x, typ) {
    if (typeof x === typ) return x;
    if (typ === "boolean") return x === "true";
    else if (typ === "number") return Number(x);
    else if (typ === "string") return x && x + "" || "";
    else throw new Error(`unsupported type: ${typ}`);
}
function _determineRuntime() {
    if (typeof Deno !== "undefined") {
        return Deno.env.get("RUNTIME") || "deno";
    }
    if (globalThis.wenv) return wenv.RUNTIME || "worker";
    if (typeof process !== "undefined") {
        if (process.env) return process.env.RUNTIME || "node";
    }
    return null;
}
class EnvManager {
    constructor(){
        this.runtime = _determineRuntime();
        this.envMap = new Map();
        this.load();
    }
    load() {
        this.envMap = this.defaultEnv();
        console.debug("env defaults", this.envMap);
    }
    determineEnvStage() {
        if (this.runtime === "node") return this.get("NODE_ENV");
        if (this.runtime === "worker") return this.get("WORKER_ENV");
        if (this.runtime === "deno") return this.get("DENO_ENV");
        return null;
    }
    mostLikelyCloudPlatform() {
        const isDev = this.determineEnvStage() === "development";
        const hasFlyAllocId = this.get("FLY_ALLOC_ID") != null;
        const hasDenoDeployId = this.get("DENO_DEPLOYMENT_ID") !== undefined;
        if (hasFlyAllocId) return "fly";
        if (hasDenoDeployId) return "deno-deploy";
        if (isDev) return "local";
        if (this.runtime === "node") return "fly";
        if (this.runtime === "deno") return "deno-deploy";
        if (this.runtime === "worker") return "cloudflare";
        return null;
    }
    defaultEnv() {
        const env = new Map();
        for (const [key, mappedKey] of Object.entries(defaults)){
            if (typeof mappedKey !== "object") continue;
            const type = mappedKey.type;
            const val = mappedKey.default;
            if (!type || val == null) {
                console.debug(key, "incomplete env val:", mappedKey);
                continue;
            }
            if (key === "CLOUD_PLATFORM") {
                env.set(key, this.mostLikelyCloudPlatform());
            } else {
                env.set(key, caststr(val, type));
            }
        }
        return env;
    }
    get(k) {
        let v = null;
        if (this.runtime === "node") {
            v = process.env[k];
        } else if (this.runtime === "deno") {
            v = Deno.env.get(k);
        } else if (this.runtime === "worker") {
            v = globalThis.wenv[k];
        }
        if (v == null) {
            v = this.envMap.get(k);
        }
        const m = defaults[k];
        if (m && v != null) v = caststr(v, m.type);
        return v;
    }
    set(k, v, typ) {
        typ = typ || "string";
        this.envMap.set(k, caststr(v, typ));
    }
}
((main)=>{
    when("prepare").then(setup);
})();
function setup() {
    if (!Deno) throw new Error("failed loading deno-specific config");
    try {
        config({
            export: true
        });
    } catch (e) {
        console.warn(".env missing => ", e.name, e.message);
    }
    const isProd = Deno.env.get("DENO_ENV") === "production";
    const onDenoDeploy1 = Deno.env.get("CLOUD_PLATFORM") === "deno-deploy";
    const profiling = Deno.env.get("PROFILE_DNS_RESOLVES") === "true";
    window.envManager = new EnvManager();
    window.log = new Log({
        level: window.envManager.get("LOG_LEVEL"),
        levelize: isProd || profiling,
        withTimestamps: !onDenoDeploy1
    });
    pub("ready");
}
const hexTable = new TextEncoder().encode("0123456789abcdef");
function errInvalidByte(__byte) {
    return new TypeError(`Invalid byte '${String.fromCharCode(__byte)}'`);
}
function errLength() {
    return new RangeError("Odd length hex string");
}
function fromHexChar(__byte) {
    if (48 <= __byte && __byte <= 57) return __byte - 48;
    if (97 <= __byte && __byte <= 102) return __byte - 97 + 10;
    if (65 <= __byte && __byte <= 70) return __byte - 65 + 10;
    throw errInvalidByte(__byte);
}
function encode(src) {
    const dst = new Uint8Array(src.length * 2);
    for(let i1 = 0; i1 < dst.length; i1++){
        const v = src[i1];
        dst[i1 * 2] = hexTable[v >> 4];
        dst[i1 * 2 + 1] = hexTable[v & 15];
    }
    return dst;
}
function decode(src) {
    const dst = new Uint8Array(src.length / 2);
    for(let i2 = 0; i2 < dst.length; i2++){
        const a = fromHexChar(src[i2 * 2]);
        const b = fromHexChar(src[i2 * 2 + 1]);
        dst[i2] = a << 4 | b;
    }
    if (src.length % 2 == 1) {
        fromHexChar(src[dst.length * 2]);
        throw errLength();
    }
    return dst;
}
const base64abc = [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "G",
    "H",
    "I",
    "J",
    "K",
    "L",
    "M",
    "N",
    "O",
    "P",
    "Q",
    "R",
    "S",
    "T",
    "U",
    "V",
    "W",
    "X",
    "Y",
    "Z",
    "a",
    "b",
    "c",
    "d",
    "e",
    "f",
    "g",
    "h",
    "i",
    "j",
    "k",
    "l",
    "m",
    "n",
    "o",
    "p",
    "q",
    "r",
    "s",
    "t",
    "u",
    "v",
    "w",
    "x",
    "y",
    "z",
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "+",
    "/"
];
function encode1(data) {
    const uint8 = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
    let result = "", i3;
    const l = uint8.length;
    for(i3 = 2; i3 < l; i3 += 3){
        result += base64abc[uint8[i3 - 2] >> 2];
        result += base64abc[(uint8[i3 - 2] & 3) << 4 | uint8[i3 - 1] >> 4];
        result += base64abc[(uint8[i3 - 1] & 15) << 2 | uint8[i3] >> 6];
        result += base64abc[uint8[i3] & 63];
    }
    if (i3 === l + 1) {
        result += base64abc[uint8[i3 - 2] >> 2];
        result += base64abc[(uint8[i3 - 2] & 3) << 4];
        result += "==";
    }
    if (i3 === l) {
        result += base64abc[uint8[i3 - 2] >> 2];
        result += base64abc[(uint8[i3 - 2] & 3) << 4 | uint8[i3 - 1] >> 4];
        result += base64abc[(uint8[i3 - 1] & 15) << 2];
        result += "=";
    }
    return result;
}
function decode1(b64) {
    const binString = atob(b64);
    const size = binString.length;
    const bytes = new Uint8Array(size);
    for(let i4 = 0; i4 < size; i4++){
        bytes[i4] = binString.charCodeAt(i4);
    }
    return bytes;
}
const { Deno: Deno1  } = globalThis;
typeof Deno1?.noColor === "boolean" ? Deno1.noColor : true;
new RegExp([
    "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
    "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))", 
].join("|"), "g");
var DiffType;
(function(DiffType1) {
    DiffType1["removed"] = "removed";
    DiffType1["common"] = "common";
    DiffType1["added"] = "added";
})(DiffType || (DiffType = {}));
class AssertionError extends Error {
    name = "AssertionError";
    constructor(message){
        super(message);
    }
}
function unreachable() {
    throw new AssertionError("unreachable");
}
function notImplemented(msg) {
    const message = msg ? `Not implemented: ${msg}` : "Not implemented";
    throw new Error(message);
}
function normalizeEncoding(enc) {
    if (enc == null || enc === "utf8" || enc === "utf-8") return "utf8";
    return slowCases(enc);
}
function slowCases(enc) {
    switch(enc.length){
        case 4:
            if (enc === "UTF8") return "utf8";
            if (enc === "ucs2" || enc === "UCS2") return "utf16le";
            enc = `${enc}`.toLowerCase();
            if (enc === "utf8") return "utf8";
            if (enc === "ucs2") return "utf16le";
            break;
        case 3:
            if (enc === "hex" || enc === "HEX" || `${enc}`.toLowerCase() === "hex") {
                return "hex";
            }
            break;
        case 5:
            if (enc === "ascii") return "ascii";
            if (enc === "ucs-2") return "utf16le";
            if (enc === "UTF-8") return "utf8";
            if (enc === "ASCII") return "ascii";
            if (enc === "UCS-2") return "utf16le";
            enc = `${enc}`.toLowerCase();
            if (enc === "utf-8") return "utf8";
            if (enc === "ascii") return "ascii";
            if (enc === "ucs-2") return "utf16le";
            break;
        case 6:
            if (enc === "base64") return "base64";
            if (enc === "latin1" || enc === "binary") return "latin1";
            if (enc === "BASE64") return "base64";
            if (enc === "LATIN1" || enc === "BINARY") return "latin1";
            enc = `${enc}`.toLowerCase();
            if (enc === "base64") return "base64";
            if (enc === "latin1" || enc === "binary") return "latin1";
            break;
        case 7:
            if (enc === "utf16le" || enc === "UTF16LE" || `${enc}`.toLowerCase() === "utf16le") {
                return "utf16le";
            }
            break;
        case 8:
            if (enc === "utf-16le" || enc === "UTF-16LE" || `${enc}`.toLowerCase() === "utf-16le") {
                return "utf16le";
            }
            break;
        default:
            if (enc === "") return "utf8";
    }
}
const kCustomPromisifiedSymbol = Symbol.for("nodejs.util.promisify.custom");
const kCustomPromisifyArgsSymbol = Symbol.for("nodejs.util.promisify.customArgs");
class NodeInvalidArgTypeError extends TypeError {
    code = "ERR_INVALID_ARG_TYPE";
    constructor(argumentName, type, received){
        super(`The "${argumentName}" argument must be of type ${type}. Received ${typeof received}`);
    }
}
function promisify(original) {
    if (typeof original !== "function") {
        throw new NodeInvalidArgTypeError("original", "Function", original);
    }
    if (original[kCustomPromisifiedSymbol]) {
        const fn = original[kCustomPromisifiedSymbol];
        if (typeof fn !== "function") {
            throw new NodeInvalidArgTypeError("util.promisify.custom", "Function", fn);
        }
        return Object.defineProperty(fn, kCustomPromisifiedSymbol, {
            value: fn,
            enumerable: false,
            writable: false,
            configurable: true
        });
    }
    const argumentNames = original[kCustomPromisifyArgsSymbol];
    function fn(...args) {
        return new Promise((resolve, reject)=>{
            original.call(this, ...args, (err, ...values)=>{
                if (err) {
                    return reject(err);
                }
                if (argumentNames !== undefined && values.length > 1) {
                    const obj = {};
                    for(let i5 = 0; i5 < argumentNames.length; i5++){
                        obj[argumentNames[i5]] = values[i5];
                    }
                    resolve(obj);
                } else {
                    resolve(values[0]);
                }
            });
        });
    }
    Object.setPrototypeOf(fn, Object.getPrototypeOf(original));
    Object.defineProperty(fn, kCustomPromisifiedSymbol, {
        value: fn,
        enumerable: false,
        writable: false,
        configurable: true
    });
    return Object.defineProperties(fn, Object.getOwnPropertyDescriptors(original));
}
promisify.custom = kCustomPromisifiedSymbol;
Object.prototype.toString;
const osType = (()=>{
    const { Deno  } = globalThis;
    if (typeof Deno?.build?.os === "string") {
        return Deno.build.os;
    }
    const { navigator  } = globalThis;
    if (navigator?.appVersion?.includes?.("Win") ?? false) {
        return "windows";
    }
    return "linux";
})();
class NodeErrorAbstraction extends Error {
    code;
    constructor(name3, code, message){
        super(message);
        this.code = code;
        this.name = name3;
        this.stack = this.stack && `${name3} [${this.code}]${this.stack.slice(20)}`;
    }
    toString() {
        return `${this.name} [${this.code}]: ${this.message}`;
    }
}
class NodeRangeError extends NodeErrorAbstraction {
    constructor(code, message){
        super(RangeError.prototype.name, code, message);
        Object.setPrototypeOf(this, RangeError.prototype);
    }
}
Number.isSafeInteger;
const DEFAULT_INSPECT_OPTIONS = {
    showHidden: false,
    depth: 2,
    colors: false,
    customInspect: true,
    showProxy: false,
    maxArrayLength: 100,
    maxStringLength: Infinity,
    breakLength: 80,
    compact: 3,
    sorted: false,
    getters: false
};
inspect.defaultOptions = DEFAULT_INSPECT_OPTIONS;
inspect.custom = Symbol.for("nodejs.util.inspect.custom");
function inspect(object, ...opts) {
    if (typeof object === "string" && !object.includes("'")) {
        return `'${object}'`;
    }
    opts = {
        ...DEFAULT_INSPECT_OPTIONS,
        ...opts
    };
    return Deno.inspect(object, {
        depth: opts.depth,
        iterableLimit: opts.maxArrayLength,
        compact: !!opts.compact,
        sorted: !!opts.sorted,
        showProxy: !!opts.showProxy
    });
}
class ERR_OUT_OF_RANGE extends RangeError {
    code = "ERR_OUT_OF_RANGE";
    constructor(str, range, received){
        super(`The value of "${str}" is out of range. It must be ${range}. Received ${received}`);
        const { name: name4  } = this;
        this.name = `${name4} [${this.code}]`;
        this.stack;
        this.name = name4;
    }
}
class ERR_BUFFER_OUT_OF_BOUNDS extends NodeRangeError {
    constructor(name5){
        super("ERR_BUFFER_OUT_OF_BOUNDS", name5 ? `"${name5}" is outside of buffer bounds` : "Attempt to access memory outside buffer bounds");
    }
}
const windows = [
    [
        -4093,
        [
            "E2BIG",
            "argument list too long"
        ]
    ],
    [
        -4092,
        [
            "EACCES",
            "permission denied"
        ]
    ],
    [
        -4091,
        [
            "EADDRINUSE",
            "address already in use"
        ]
    ],
    [
        -4090,
        [
            "EADDRNOTAVAIL",
            "address not available"
        ]
    ],
    [
        -4089,
        [
            "EAFNOSUPPORT",
            "address family not supported"
        ]
    ],
    [
        -4088,
        [
            "EAGAIN",
            "resource temporarily unavailable"
        ]
    ],
    [
        -3000,
        [
            "EAI_ADDRFAMILY",
            "address family not supported"
        ]
    ],
    [
        -3001,
        [
            "EAI_AGAIN",
            "temporary failure"
        ]
    ],
    [
        -3002,
        [
            "EAI_BADFLAGS",
            "bad ai_flags value"
        ]
    ],
    [
        -3013,
        [
            "EAI_BADHINTS",
            "invalid value for hints"
        ]
    ],
    [
        -3003,
        [
            "EAI_CANCELED",
            "request canceled"
        ]
    ],
    [
        -3004,
        [
            "EAI_FAIL",
            "permanent failure"
        ]
    ],
    [
        -3005,
        [
            "EAI_FAMILY",
            "ai_family not supported"
        ]
    ],
    [
        -3006,
        [
            "EAI_MEMORY",
            "out of memory"
        ]
    ],
    [
        -3007,
        [
            "EAI_NODATA",
            "no address"
        ]
    ],
    [
        -3008,
        [
            "EAI_NONAME",
            "unknown node or service"
        ]
    ],
    [
        -3009,
        [
            "EAI_OVERFLOW",
            "argument buffer overflow"
        ]
    ],
    [
        -3014,
        [
            "EAI_PROTOCOL",
            "resolved protocol is unknown"
        ]
    ],
    [
        -3010,
        [
            "EAI_SERVICE",
            "service not available for socket type"
        ]
    ],
    [
        -3011,
        [
            "EAI_SOCKTYPE",
            "socket type not supported"
        ]
    ],
    [
        -4084,
        [
            "EALREADY",
            "connection already in progress"
        ]
    ],
    [
        -4083,
        [
            "EBADF",
            "bad file descriptor"
        ]
    ],
    [
        -4082,
        [
            "EBUSY",
            "resource busy or locked"
        ]
    ],
    [
        -4081,
        [
            "ECANCELED",
            "operation canceled"
        ]
    ],
    [
        -4080,
        [
            "ECHARSET",
            "invalid Unicode character"
        ]
    ],
    [
        -4079,
        [
            "ECONNABORTED",
            "software caused connection abort"
        ]
    ],
    [
        -4078,
        [
            "ECONNREFUSED",
            "connection refused"
        ]
    ],
    [
        -4077,
        [
            "ECONNRESET",
            "connection reset by peer"
        ]
    ],
    [
        -4076,
        [
            "EDESTADDRREQ",
            "destination address required"
        ]
    ],
    [
        -4075,
        [
            "EEXIST",
            "file already exists"
        ]
    ],
    [
        -4074,
        [
            "EFAULT",
            "bad address in system call argument"
        ]
    ],
    [
        -4036,
        [
            "EFBIG",
            "file too large"
        ]
    ],
    [
        -4073,
        [
            "EHOSTUNREACH",
            "host is unreachable"
        ]
    ],
    [
        -4072,
        [
            "EINTR",
            "interrupted system call"
        ]
    ],
    [
        -4071,
        [
            "EINVAL",
            "invalid argument"
        ]
    ],
    [
        -4070,
        [
            "EIO",
            "i/o error"
        ]
    ],
    [
        -4069,
        [
            "EISCONN",
            "socket is already connected"
        ]
    ],
    [
        -4068,
        [
            "EISDIR",
            "illegal operation on a directory"
        ]
    ],
    [
        -4067,
        [
            "ELOOP",
            "too many symbolic links encountered"
        ]
    ],
    [
        -4066,
        [
            "EMFILE",
            "too many open files"
        ]
    ],
    [
        -4065,
        [
            "EMSGSIZE",
            "message too long"
        ]
    ],
    [
        -4064,
        [
            "ENAMETOOLONG",
            "name too long"
        ]
    ],
    [
        -4063,
        [
            "ENETDOWN",
            "network is down"
        ]
    ],
    [
        -4062,
        [
            "ENETUNREACH",
            "network is unreachable"
        ]
    ],
    [
        -4061,
        [
            "ENFILE",
            "file table overflow"
        ]
    ],
    [
        -4060,
        [
            "ENOBUFS",
            "no buffer space available"
        ]
    ],
    [
        -4059,
        [
            "ENODEV",
            "no such device"
        ]
    ],
    [
        -4058,
        [
            "ENOENT",
            "no such file or directory"
        ]
    ],
    [
        -4057,
        [
            "ENOMEM",
            "not enough memory"
        ]
    ],
    [
        -4056,
        [
            "ENONET",
            "machine is not on the network"
        ]
    ],
    [
        -4035,
        [
            "ENOPROTOOPT",
            "protocol not available"
        ]
    ],
    [
        -4055,
        [
            "ENOSPC",
            "no space left on device"
        ]
    ],
    [
        -4054,
        [
            "ENOSYS",
            "function not implemented"
        ]
    ],
    [
        -4053,
        [
            "ENOTCONN",
            "socket is not connected"
        ]
    ],
    [
        -4052,
        [
            "ENOTDIR",
            "not a directory"
        ]
    ],
    [
        -4051,
        [
            "ENOTEMPTY",
            "directory not empty"
        ]
    ],
    [
        -4050,
        [
            "ENOTSOCK",
            "socket operation on non-socket"
        ]
    ],
    [
        -4049,
        [
            "ENOTSUP",
            "operation not supported on socket"
        ]
    ],
    [
        -4048,
        [
            "EPERM",
            "operation not permitted"
        ]
    ],
    [
        -4047,
        [
            "EPIPE",
            "broken pipe"
        ]
    ],
    [
        -4046,
        [
            "EPROTO",
            "protocol error"
        ]
    ],
    [
        -4045,
        [
            "EPROTONOSUPPORT",
            "protocol not supported"
        ]
    ],
    [
        -4044,
        [
            "EPROTOTYPE",
            "protocol wrong type for socket"
        ]
    ],
    [
        -4034,
        [
            "ERANGE",
            "result too large"
        ]
    ],
    [
        -4043,
        [
            "EROFS",
            "read-only file system"
        ]
    ],
    [
        -4042,
        [
            "ESHUTDOWN",
            "cannot send after transport endpoint shutdown"
        ]
    ],
    [
        -4041,
        [
            "ESPIPE",
            "invalid seek"
        ]
    ],
    [
        -4040,
        [
            "ESRCH",
            "no such process"
        ]
    ],
    [
        -4039,
        [
            "ETIMEDOUT",
            "connection timed out"
        ]
    ],
    [
        -4038,
        [
            "ETXTBSY",
            "text file is busy"
        ]
    ],
    [
        -4037,
        [
            "EXDEV",
            "cross-device link not permitted"
        ]
    ],
    [
        -4094,
        [
            "UNKNOWN",
            "unknown error"
        ]
    ],
    [
        -4095,
        [
            "EOF",
            "end of file"
        ]
    ],
    [
        -4033,
        [
            "ENXIO",
            "no such device or address"
        ]
    ],
    [
        -4032,
        [
            "EMLINK",
            "too many links"
        ]
    ],
    [
        -4031,
        [
            "EHOSTDOWN",
            "host is down"
        ]
    ],
    [
        -4030,
        [
            "EREMOTEIO",
            "remote I/O error"
        ]
    ],
    [
        -4029,
        [
            "ENOTTY",
            "inappropriate ioctl for device"
        ]
    ],
    [
        -4028,
        [
            "EFTYPE",
            "inappropriate file type or format"
        ]
    ],
    [
        -4027,
        [
            "EILSEQ",
            "illegal byte sequence"
        ]
    ], 
];
const darwin = [
    [
        -7,
        [
            "E2BIG",
            "argument list too long"
        ]
    ],
    [
        -13,
        [
            "EACCES",
            "permission denied"
        ]
    ],
    [
        -48,
        [
            "EADDRINUSE",
            "address already in use"
        ]
    ],
    [
        -49,
        [
            "EADDRNOTAVAIL",
            "address not available"
        ]
    ],
    [
        -47,
        [
            "EAFNOSUPPORT",
            "address family not supported"
        ]
    ],
    [
        -35,
        [
            "EAGAIN",
            "resource temporarily unavailable"
        ]
    ],
    [
        -3000,
        [
            "EAI_ADDRFAMILY",
            "address family not supported"
        ]
    ],
    [
        -3001,
        [
            "EAI_AGAIN",
            "temporary failure"
        ]
    ],
    [
        -3002,
        [
            "EAI_BADFLAGS",
            "bad ai_flags value"
        ]
    ],
    [
        -3013,
        [
            "EAI_BADHINTS",
            "invalid value for hints"
        ]
    ],
    [
        -3003,
        [
            "EAI_CANCELED",
            "request canceled"
        ]
    ],
    [
        -3004,
        [
            "EAI_FAIL",
            "permanent failure"
        ]
    ],
    [
        -3005,
        [
            "EAI_FAMILY",
            "ai_family not supported"
        ]
    ],
    [
        -3006,
        [
            "EAI_MEMORY",
            "out of memory"
        ]
    ],
    [
        -3007,
        [
            "EAI_NODATA",
            "no address"
        ]
    ],
    [
        -3008,
        [
            "EAI_NONAME",
            "unknown node or service"
        ]
    ],
    [
        -3009,
        [
            "EAI_OVERFLOW",
            "argument buffer overflow"
        ]
    ],
    [
        -3014,
        [
            "EAI_PROTOCOL",
            "resolved protocol is unknown"
        ]
    ],
    [
        -3010,
        [
            "EAI_SERVICE",
            "service not available for socket type"
        ]
    ],
    [
        -3011,
        [
            "EAI_SOCKTYPE",
            "socket type not supported"
        ]
    ],
    [
        -37,
        [
            "EALREADY",
            "connection already in progress"
        ]
    ],
    [
        -9,
        [
            "EBADF",
            "bad file descriptor"
        ]
    ],
    [
        -16,
        [
            "EBUSY",
            "resource busy or locked"
        ]
    ],
    [
        -89,
        [
            "ECANCELED",
            "operation canceled"
        ]
    ],
    [
        -4080,
        [
            "ECHARSET",
            "invalid Unicode character"
        ]
    ],
    [
        -53,
        [
            "ECONNABORTED",
            "software caused connection abort"
        ]
    ],
    [
        -61,
        [
            "ECONNREFUSED",
            "connection refused"
        ]
    ],
    [
        -54,
        [
            "ECONNRESET",
            "connection reset by peer"
        ]
    ],
    [
        -39,
        [
            "EDESTADDRREQ",
            "destination address required"
        ]
    ],
    [
        -17,
        [
            "EEXIST",
            "file already exists"
        ]
    ],
    [
        -14,
        [
            "EFAULT",
            "bad address in system call argument"
        ]
    ],
    [
        -27,
        [
            "EFBIG",
            "file too large"
        ]
    ],
    [
        -65,
        [
            "EHOSTUNREACH",
            "host is unreachable"
        ]
    ],
    [
        -4,
        [
            "EINTR",
            "interrupted system call"
        ]
    ],
    [
        -22,
        [
            "EINVAL",
            "invalid argument"
        ]
    ],
    [
        -5,
        [
            "EIO",
            "i/o error"
        ]
    ],
    [
        -56,
        [
            "EISCONN",
            "socket is already connected"
        ]
    ],
    [
        -21,
        [
            "EISDIR",
            "illegal operation on a directory"
        ]
    ],
    [
        -62,
        [
            "ELOOP",
            "too many symbolic links encountered"
        ]
    ],
    [
        -24,
        [
            "EMFILE",
            "too many open files"
        ]
    ],
    [
        -40,
        [
            "EMSGSIZE",
            "message too long"
        ]
    ],
    [
        -63,
        [
            "ENAMETOOLONG",
            "name too long"
        ]
    ],
    [
        -50,
        [
            "ENETDOWN",
            "network is down"
        ]
    ],
    [
        -51,
        [
            "ENETUNREACH",
            "network is unreachable"
        ]
    ],
    [
        -23,
        [
            "ENFILE",
            "file table overflow"
        ]
    ],
    [
        -55,
        [
            "ENOBUFS",
            "no buffer space available"
        ]
    ],
    [
        -19,
        [
            "ENODEV",
            "no such device"
        ]
    ],
    [
        -2,
        [
            "ENOENT",
            "no such file or directory"
        ]
    ],
    [
        -12,
        [
            "ENOMEM",
            "not enough memory"
        ]
    ],
    [
        -4056,
        [
            "ENONET",
            "machine is not on the network"
        ]
    ],
    [
        -42,
        [
            "ENOPROTOOPT",
            "protocol not available"
        ]
    ],
    [
        -28,
        [
            "ENOSPC",
            "no space left on device"
        ]
    ],
    [
        -78,
        [
            "ENOSYS",
            "function not implemented"
        ]
    ],
    [
        -57,
        [
            "ENOTCONN",
            "socket is not connected"
        ]
    ],
    [
        -20,
        [
            "ENOTDIR",
            "not a directory"
        ]
    ],
    [
        -66,
        [
            "ENOTEMPTY",
            "directory not empty"
        ]
    ],
    [
        -38,
        [
            "ENOTSOCK",
            "socket operation on non-socket"
        ]
    ],
    [
        -45,
        [
            "ENOTSUP",
            "operation not supported on socket"
        ]
    ],
    [
        -1,
        [
            "EPERM",
            "operation not permitted"
        ]
    ],
    [
        -32,
        [
            "EPIPE",
            "broken pipe"
        ]
    ],
    [
        -100,
        [
            "EPROTO",
            "protocol error"
        ]
    ],
    [
        -43,
        [
            "EPROTONOSUPPORT",
            "protocol not supported"
        ]
    ],
    [
        -41,
        [
            "EPROTOTYPE",
            "protocol wrong type for socket"
        ]
    ],
    [
        -34,
        [
            "ERANGE",
            "result too large"
        ]
    ],
    [
        -30,
        [
            "EROFS",
            "read-only file system"
        ]
    ],
    [
        -58,
        [
            "ESHUTDOWN",
            "cannot send after transport endpoint shutdown"
        ]
    ],
    [
        -29,
        [
            "ESPIPE",
            "invalid seek"
        ]
    ],
    [
        -3,
        [
            "ESRCH",
            "no such process"
        ]
    ],
    [
        -60,
        [
            "ETIMEDOUT",
            "connection timed out"
        ]
    ],
    [
        -26,
        [
            "ETXTBSY",
            "text file is busy"
        ]
    ],
    [
        -18,
        [
            "EXDEV",
            "cross-device link not permitted"
        ]
    ],
    [
        -4094,
        [
            "UNKNOWN",
            "unknown error"
        ]
    ],
    [
        -4095,
        [
            "EOF",
            "end of file"
        ]
    ],
    [
        -6,
        [
            "ENXIO",
            "no such device or address"
        ]
    ],
    [
        -31,
        [
            "EMLINK",
            "too many links"
        ]
    ],
    [
        -64,
        [
            "EHOSTDOWN",
            "host is down"
        ]
    ],
    [
        -4030,
        [
            "EREMOTEIO",
            "remote I/O error"
        ]
    ],
    [
        -25,
        [
            "ENOTTY",
            "inappropriate ioctl for device"
        ]
    ],
    [
        -79,
        [
            "EFTYPE",
            "inappropriate file type or format"
        ]
    ],
    [
        -92,
        [
            "EILSEQ",
            "illegal byte sequence"
        ]
    ], 
];
const linux = [
    [
        -7,
        [
            "E2BIG",
            "argument list too long"
        ]
    ],
    [
        -13,
        [
            "EACCES",
            "permission denied"
        ]
    ],
    [
        -98,
        [
            "EADDRINUSE",
            "address already in use"
        ]
    ],
    [
        -99,
        [
            "EADDRNOTAVAIL",
            "address not available"
        ]
    ],
    [
        -97,
        [
            "EAFNOSUPPORT",
            "address family not supported"
        ]
    ],
    [
        -11,
        [
            "EAGAIN",
            "resource temporarily unavailable"
        ]
    ],
    [
        -3000,
        [
            "EAI_ADDRFAMILY",
            "address family not supported"
        ]
    ],
    [
        -3001,
        [
            "EAI_AGAIN",
            "temporary failure"
        ]
    ],
    [
        -3002,
        [
            "EAI_BADFLAGS",
            "bad ai_flags value"
        ]
    ],
    [
        -3013,
        [
            "EAI_BADHINTS",
            "invalid value for hints"
        ]
    ],
    [
        -3003,
        [
            "EAI_CANCELED",
            "request canceled"
        ]
    ],
    [
        -3004,
        [
            "EAI_FAIL",
            "permanent failure"
        ]
    ],
    [
        -3005,
        [
            "EAI_FAMILY",
            "ai_family not supported"
        ]
    ],
    [
        -3006,
        [
            "EAI_MEMORY",
            "out of memory"
        ]
    ],
    [
        -3007,
        [
            "EAI_NODATA",
            "no address"
        ]
    ],
    [
        -3008,
        [
            "EAI_NONAME",
            "unknown node or service"
        ]
    ],
    [
        -3009,
        [
            "EAI_OVERFLOW",
            "argument buffer overflow"
        ]
    ],
    [
        -3014,
        [
            "EAI_PROTOCOL",
            "resolved protocol is unknown"
        ]
    ],
    [
        -3010,
        [
            "EAI_SERVICE",
            "service not available for socket type"
        ]
    ],
    [
        -3011,
        [
            "EAI_SOCKTYPE",
            "socket type not supported"
        ]
    ],
    [
        -114,
        [
            "EALREADY",
            "connection already in progress"
        ]
    ],
    [
        -9,
        [
            "EBADF",
            "bad file descriptor"
        ]
    ],
    [
        -16,
        [
            "EBUSY",
            "resource busy or locked"
        ]
    ],
    [
        -125,
        [
            "ECANCELED",
            "operation canceled"
        ]
    ],
    [
        -4080,
        [
            "ECHARSET",
            "invalid Unicode character"
        ]
    ],
    [
        -103,
        [
            "ECONNABORTED",
            "software caused connection abort"
        ]
    ],
    [
        -111,
        [
            "ECONNREFUSED",
            "connection refused"
        ]
    ],
    [
        -104,
        [
            "ECONNRESET",
            "connection reset by peer"
        ]
    ],
    [
        -89,
        [
            "EDESTADDRREQ",
            "destination address required"
        ]
    ],
    [
        -17,
        [
            "EEXIST",
            "file already exists"
        ]
    ],
    [
        -14,
        [
            "EFAULT",
            "bad address in system call argument"
        ]
    ],
    [
        -27,
        [
            "EFBIG",
            "file too large"
        ]
    ],
    [
        -113,
        [
            "EHOSTUNREACH",
            "host is unreachable"
        ]
    ],
    [
        -4,
        [
            "EINTR",
            "interrupted system call"
        ]
    ],
    [
        -22,
        [
            "EINVAL",
            "invalid argument"
        ]
    ],
    [
        -5,
        [
            "EIO",
            "i/o error"
        ]
    ],
    [
        -106,
        [
            "EISCONN",
            "socket is already connected"
        ]
    ],
    [
        -21,
        [
            "EISDIR",
            "illegal operation on a directory"
        ]
    ],
    [
        -40,
        [
            "ELOOP",
            "too many symbolic links encountered"
        ]
    ],
    [
        -24,
        [
            "EMFILE",
            "too many open files"
        ]
    ],
    [
        -90,
        [
            "EMSGSIZE",
            "message too long"
        ]
    ],
    [
        -36,
        [
            "ENAMETOOLONG",
            "name too long"
        ]
    ],
    [
        -100,
        [
            "ENETDOWN",
            "network is down"
        ]
    ],
    [
        -101,
        [
            "ENETUNREACH",
            "network is unreachable"
        ]
    ],
    [
        -23,
        [
            "ENFILE",
            "file table overflow"
        ]
    ],
    [
        -105,
        [
            "ENOBUFS",
            "no buffer space available"
        ]
    ],
    [
        -19,
        [
            "ENODEV",
            "no such device"
        ]
    ],
    [
        -2,
        [
            "ENOENT",
            "no such file or directory"
        ]
    ],
    [
        -12,
        [
            "ENOMEM",
            "not enough memory"
        ]
    ],
    [
        -64,
        [
            "ENONET",
            "machine is not on the network"
        ]
    ],
    [
        -92,
        [
            "ENOPROTOOPT",
            "protocol not available"
        ]
    ],
    [
        -28,
        [
            "ENOSPC",
            "no space left on device"
        ]
    ],
    [
        -38,
        [
            "ENOSYS",
            "function not implemented"
        ]
    ],
    [
        -107,
        [
            "ENOTCONN",
            "socket is not connected"
        ]
    ],
    [
        -20,
        [
            "ENOTDIR",
            "not a directory"
        ]
    ],
    [
        -39,
        [
            "ENOTEMPTY",
            "directory not empty"
        ]
    ],
    [
        -88,
        [
            "ENOTSOCK",
            "socket operation on non-socket"
        ]
    ],
    [
        -95,
        [
            "ENOTSUP",
            "operation not supported on socket"
        ]
    ],
    [
        -1,
        [
            "EPERM",
            "operation not permitted"
        ]
    ],
    [
        -32,
        [
            "EPIPE",
            "broken pipe"
        ]
    ],
    [
        -71,
        [
            "EPROTO",
            "protocol error"
        ]
    ],
    [
        -93,
        [
            "EPROTONOSUPPORT",
            "protocol not supported"
        ]
    ],
    [
        -91,
        [
            "EPROTOTYPE",
            "protocol wrong type for socket"
        ]
    ],
    [
        -34,
        [
            "ERANGE",
            "result too large"
        ]
    ],
    [
        -30,
        [
            "EROFS",
            "read-only file system"
        ]
    ],
    [
        -108,
        [
            "ESHUTDOWN",
            "cannot send after transport endpoint shutdown"
        ]
    ],
    [
        -29,
        [
            "ESPIPE",
            "invalid seek"
        ]
    ],
    [
        -3,
        [
            "ESRCH",
            "no such process"
        ]
    ],
    [
        -110,
        [
            "ETIMEDOUT",
            "connection timed out"
        ]
    ],
    [
        -26,
        [
            "ETXTBSY",
            "text file is busy"
        ]
    ],
    [
        -18,
        [
            "EXDEV",
            "cross-device link not permitted"
        ]
    ],
    [
        -4094,
        [
            "UNKNOWN",
            "unknown error"
        ]
    ],
    [
        -4095,
        [
            "EOF",
            "end of file"
        ]
    ],
    [
        -6,
        [
            "ENXIO",
            "no such device or address"
        ]
    ],
    [
        -31,
        [
            "EMLINK",
            "too many links"
        ]
    ],
    [
        -112,
        [
            "EHOSTDOWN",
            "host is down"
        ]
    ],
    [
        -121,
        [
            "EREMOTEIO",
            "remote I/O error"
        ]
    ],
    [
        -25,
        [
            "ENOTTY",
            "inappropriate ioctl for device"
        ]
    ],
    [
        -4028,
        [
            "EFTYPE",
            "inappropriate file type or format"
        ]
    ],
    [
        -84,
        [
            "EILSEQ",
            "illegal byte sequence"
        ]
    ], 
];
new Map(osType === "windows" ? windows : osType === "darwin" ? darwin : osType === "linux" ? linux : unreachable());
const notImplementedEncodings = [
    "ascii",
    "binary",
    "latin1",
    "ucs2",
    "utf16le", 
];
function checkEncoding(encoding = "utf8", strict = true) {
    if (typeof encoding !== "string" || strict && encoding === "") {
        if (!strict) return "utf8";
        throw new TypeError(`Unknown encoding: ${encoding}`);
    }
    const normalized = normalizeEncoding(encoding);
    if (normalized === undefined) {
        throw new TypeError(`Unknown encoding: ${encoding}`);
    }
    if (notImplementedEncodings.includes(encoding)) {
        notImplemented(`"${encoding}" encoding`);
    }
    return normalized;
}
const encodingOps = {
    utf8: {
        byteLength: (string1)=>new TextEncoder().encode(string1).byteLength
    },
    ucs2: {
        byteLength: (string2)=>string2.length * 2
    },
    utf16le: {
        byteLength: (string3)=>string3.length * 2
    },
    latin1: {
        byteLength: (string4)=>string4.length
    },
    ascii: {
        byteLength: (string5)=>string5.length
    },
    base64: {
        byteLength: (string6)=>base64ByteLength(string6, string6.length)
    },
    hex: {
        byteLength: (string7)=>string7.length >>> 1
    }
};
function base64ByteLength(str, bytes) {
    if (str.charCodeAt(bytes - 1) === 61) bytes--;
    if (bytes > 1 && str.charCodeAt(bytes - 1) === 61) bytes--;
    return bytes * 3 >>> 2;
}
class Buffer extends Uint8Array {
    static alloc(size, fill, encoding = "utf8") {
        if (typeof size !== "number") {
            throw new TypeError(`The "size" argument must be of type number. Received type ${typeof size}`);
        }
        const buf = new Buffer(size);
        if (size === 0) return buf;
        let bufFill;
        if (typeof fill === "string") {
            const clearEncoding = checkEncoding(encoding);
            if (typeof fill === "string" && fill.length === 1 && clearEncoding === "utf8") {
                buf.fill(fill.charCodeAt(0));
            } else bufFill = Buffer.from(fill, clearEncoding);
        } else if (typeof fill === "number") {
            buf.fill(fill);
        } else if (fill instanceof Uint8Array) {
            if (fill.length === 0) {
                throw new TypeError(`The argument "value" is invalid. Received ${fill.constructor.name} []`);
            }
            bufFill = fill;
        }
        if (bufFill) {
            if (bufFill.length > buf.length) {
                bufFill = bufFill.subarray(0, buf.length);
            }
            let offset = 0;
            while(offset < size){
                buf.set(bufFill, offset);
                offset += bufFill.length;
                if (offset + bufFill.length >= size) break;
            }
            if (offset !== size) {
                buf.set(bufFill.subarray(0, size - offset), offset);
            }
        }
        return buf;
    }
    static allocUnsafe(size) {
        return new Buffer(size);
    }
    static byteLength(string8, encoding = "utf8") {
        if (typeof string8 != "string") return string8.byteLength;
        encoding = normalizeEncoding(encoding) || "utf8";
        return encodingOps[encoding].byteLength(string8);
    }
    static concat(list, totalLength) {
        if (totalLength == undefined) {
            totalLength = 0;
            for (const buf of list){
                totalLength += buf.length;
            }
        }
        const buffer = Buffer.allocUnsafe(totalLength);
        let pos = 0;
        for (const item of list){
            let buf;
            if (!(item instanceof Buffer)) {
                buf = Buffer.from(item);
            } else {
                buf = item;
            }
            buf.copy(buffer, pos);
            pos += buf.length;
        }
        return buffer;
    }
    static from(value, offsetOrEncoding, length) {
        const offset = typeof offsetOrEncoding === "string" ? undefined : offsetOrEncoding;
        let encoding = typeof offsetOrEncoding === "string" ? offsetOrEncoding : undefined;
        if (typeof value == "string") {
            encoding = checkEncoding(encoding, false);
            if (encoding === "hex") {
                return new Buffer(decode(new TextEncoder().encode(value)).buffer);
            }
            if (encoding === "base64") return new Buffer(decode1(value).buffer);
            return new Buffer(new TextEncoder().encode(value).buffer);
        }
        return new Buffer(value, offset, length);
    }
    static isBuffer(obj) {
        return obj instanceof Buffer;
    }
    static isEncoding(encoding) {
        return typeof encoding === "string" && encoding.length !== 0 && normalizeEncoding(encoding) !== undefined;
    }
    boundsError(value, length, type) {
        if (Math.floor(value) !== value) {
            throw new ERR_OUT_OF_RANGE(type || "offset", "an integer", value);
        }
        if (length < 0) throw new ERR_BUFFER_OUT_OF_BOUNDS();
        throw new ERR_OUT_OF_RANGE(type || "offset", `>= ${type ? 1 : 0} and <= ${length}`, value);
    }
    readUIntBE(offset = 0, byteLength) {
        if (byteLength === 3 || byteLength === 5 || byteLength === 6) {
            notImplemented(`byteLength ${byteLength}`);
        }
        if (byteLength === 4) return this.readUInt32BE(offset);
        if (byteLength === 2) return this.readUInt16BE(offset);
        if (byteLength === 1) return this.readUInt8(offset);
        this.boundsError(byteLength, 4, "byteLength");
    }
    readUIntLE(offset = 0, byteLength) {
        if (byteLength === 3 || byteLength === 5 || byteLength === 6) {
            notImplemented(`byteLength ${byteLength}`);
        }
        if (byteLength === 4) return this.readUInt32LE(offset);
        if (byteLength === 2) return this.readUInt16LE(offset);
        if (byteLength === 1) return this.readUInt8(offset);
        this.boundsError(byteLength, 4, "byteLength");
    }
    copy(targetBuffer, targetStart = 0, sourceStart = 0, sourceEnd = this.length) {
        const sourceBuffer = this.subarray(sourceStart, sourceEnd).subarray(0, Math.max(0, targetBuffer.length - targetStart));
        if (sourceBuffer.length === 0) return 0;
        targetBuffer.set(sourceBuffer, targetStart);
        return sourceBuffer.length;
    }
    equals(otherBuffer) {
        if (!(otherBuffer instanceof Uint8Array)) {
            throw new TypeError(`The "otherBuffer" argument must be an instance of Buffer or Uint8Array. Received type ${typeof otherBuffer}`);
        }
        if (this === otherBuffer) return true;
        if (this.byteLength !== otherBuffer.byteLength) return false;
        for(let i6 = 0; i6 < this.length; i6++){
            if (this[i6] !== otherBuffer[i6]) return false;
        }
        return true;
    }
    readBigInt64BE(offset = 0) {
        return new DataView(this.buffer, this.byteOffset, this.byteLength).getBigInt64(offset);
    }
    readBigInt64LE(offset = 0) {
        return new DataView(this.buffer, this.byteOffset, this.byteLength).getBigInt64(offset, true);
    }
    readBigUInt64BE(offset = 0) {
        return new DataView(this.buffer, this.byteOffset, this.byteLength).getBigUint64(offset);
    }
    readBigUInt64LE(offset = 0) {
        return new DataView(this.buffer, this.byteOffset, this.byteLength).getBigUint64(offset, true);
    }
    readDoubleBE(offset = 0) {
        return new DataView(this.buffer, this.byteOffset, this.byteLength).getFloat64(offset);
    }
    readDoubleLE(offset = 0) {
        return new DataView(this.buffer, this.byteOffset, this.byteLength).getFloat64(offset, true);
    }
    readFloatBE(offset = 0) {
        return new DataView(this.buffer, this.byteOffset, this.byteLength).getFloat32(offset);
    }
    readFloatLE(offset = 0) {
        return new DataView(this.buffer, this.byteOffset, this.byteLength).getFloat32(offset, true);
    }
    readInt8(offset = 0) {
        return new DataView(this.buffer, this.byteOffset, this.byteLength).getInt8(offset);
    }
    readInt16BE(offset = 0) {
        return new DataView(this.buffer, this.byteOffset, this.byteLength).getInt16(offset);
    }
    readInt16LE(offset = 0) {
        return new DataView(this.buffer, this.byteOffset, this.byteLength).getInt16(offset, true);
    }
    readInt32BE(offset = 0) {
        return new DataView(this.buffer, this.byteOffset, this.byteLength).getInt32(offset);
    }
    readInt32LE(offset = 0) {
        return new DataView(this.buffer, this.byteOffset, this.byteLength).getInt32(offset, true);
    }
    readUInt8(offset = 0) {
        return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint8(offset);
    }
    readUInt16BE(offset = 0) {
        return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint16(offset);
    }
    readUInt16LE(offset = 0) {
        return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint16(offset, true);
    }
    readUInt32BE(offset = 0) {
        return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint32(offset);
    }
    readUInt32LE(offset = 0) {
        return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint32(offset, true);
    }
    slice(begin = 0, end = this.length) {
        return this.subarray(begin, end);
    }
    toJSON() {
        return {
            type: "Buffer",
            data: Array.from(this)
        };
    }
    toString(encoding = "utf8", start = 0, end = this.length) {
        encoding = checkEncoding(encoding);
        const b = this.subarray(start, end);
        if (encoding === "hex") return new TextDecoder().decode(encode(b));
        if (encoding === "base64") return encode1(b);
        return new TextDecoder(encoding).decode(b);
    }
    write(string9, offset = 0, length = this.length) {
        return new TextEncoder().encodeInto(string9, this.subarray(offset, offset + length)).written;
    }
    writeBigInt64BE(value, offset = 0) {
        new DataView(this.buffer, this.byteOffset, this.byteLength).setBigInt64(offset, value);
        return offset + 4;
    }
    writeBigInt64LE(value, offset = 0) {
        new DataView(this.buffer, this.byteOffset, this.byteLength).setBigInt64(offset, value, true);
        return offset + 4;
    }
    writeBigUInt64BE(value, offset = 0) {
        new DataView(this.buffer, this.byteOffset, this.byteLength).setBigUint64(offset, value);
        return offset + 4;
    }
    writeBigUInt64LE(value, offset = 0) {
        new DataView(this.buffer, this.byteOffset, this.byteLength).setBigUint64(offset, value, true);
        return offset + 4;
    }
    writeDoubleBE(value, offset = 0) {
        new DataView(this.buffer, this.byteOffset, this.byteLength).setFloat64(offset, value);
        return offset + 8;
    }
    writeDoubleLE(value, offset = 0) {
        new DataView(this.buffer, this.byteOffset, this.byteLength).setFloat64(offset, value, true);
        return offset + 8;
    }
    writeFloatBE(value, offset = 0) {
        new DataView(this.buffer, this.byteOffset, this.byteLength).setFloat32(offset, value);
        return offset + 4;
    }
    writeFloatLE(value, offset = 0) {
        new DataView(this.buffer, this.byteOffset, this.byteLength).setFloat32(offset, value, true);
        return offset + 4;
    }
    writeInt8(value, offset = 0) {
        new DataView(this.buffer, this.byteOffset, this.byteLength).setInt8(offset, value);
        return offset + 1;
    }
    writeInt16BE(value, offset = 0) {
        new DataView(this.buffer, this.byteOffset, this.byteLength).setInt16(offset, value);
        return offset + 2;
    }
    writeInt16LE(value, offset = 0) {
        new DataView(this.buffer, this.byteOffset, this.byteLength).setInt16(offset, value, true);
        return offset + 2;
    }
    writeInt32BE(value, offset = 0) {
        new DataView(this.buffer, this.byteOffset, this.byteLength).setUint32(offset, value);
        return offset + 4;
    }
    writeInt32LE(value, offset = 0) {
        new DataView(this.buffer, this.byteOffset, this.byteLength).setInt32(offset, value, true);
        return offset + 4;
    }
    writeUInt8(value, offset = 0) {
        new DataView(this.buffer, this.byteOffset, this.byteLength).setUint8(offset, value);
        return offset + 1;
    }
    writeUInt16BE(value, offset = 0) {
        new DataView(this.buffer, this.byteOffset, this.byteLength).setUint16(offset, value);
        return offset + 2;
    }
    writeUInt16LE(value, offset = 0) {
        new DataView(this.buffer, this.byteOffset, this.byteLength).setUint16(offset, value, true);
        return offset + 2;
    }
    writeUInt32BE(value, offset = 0) {
        new DataView(this.buffer, this.byteOffset, this.byteLength).setUint32(offset, value);
        return offset + 4;
    }
    writeUInt32LE(value, offset = 0) {
        new DataView(this.buffer, this.byteOffset, this.byteLength).setUint32(offset, value, true);
        return offset + 4;
    }
}
globalThis.atob;
globalThis.btoa;
function bytesToBase64Url(b) {
    return btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\//g, "_").replace(/\+/g, "-").replace(/=/g, "");
}
function binaryStringToBytes(bs) {
    const len = bs.length;
    const bytes = new Uint8Array(len);
    for(let i7 = 0; i7 < len; i7++){
        bytes[i7] = bs.charCodeAt(i7);
    }
    return bytes;
}
function regularBase64(b64url) {
    if (emptyString(b64url)) return b64url;
    return b64url.replace(/_/g, "/").replace(/-/g, "+");
}
function base64ToUint8(b64uri) {
    const b64url = decodeURI(b64uri);
    const binaryStr = atob(regularBase64(b64url));
    return binaryStringToBytes(binaryStr);
}
function base64ToUint16(b64uri) {
    const b64url = decodeURI(b64uri);
    const binaryStr = atob(regularBase64(b64url));
    return decodeFromBinary(binaryStr);
}
function base64ToBytes(b64uri) {
    return base64ToUint8(b64uri).buffer;
}
function decodeFromBinary(b, u8) {
    if (u8) return new Uint16Array(b.buffer);
    const bytes = binaryStringToBytes(b);
    return new Uint16Array(bytes.buffer);
}
function decodeFromBinaryArray(b) {
    return decodeFromBinary(b, true);
}
function emptyBuf(b) {
    return !b || b.byteLength <= 0;
}
function arrayBufferOf(buf) {
    if (emptyBuf(buf)) return null;
    const offset = buf.byteOffset;
    const len = buf.byteLength;
    return buf.buffer.slice(offset, offset + len);
}
function bufferOf(arrayBuf) {
    if (emptyBuf(arrayBuf)) return null;
    return Buffer.from(new Uint8Array(arrayBuf));
}
function encodeUint8ArrayBE(n, len) {
    const o = n;
    if (!n) return new Uint8Array(len);
    const a = [];
    a.unshift(n & 255);
    while(n >= 256){
        n = n >>> 8;
        a.unshift(n & 255);
    }
    if (a.length > len) {
        throw new RangeError(`Cannot encode ${o} in ${len} len Uint8Array`);
    }
    let fill = len - a.length;
    while(fill--)a.unshift(0);
    return new Uint8Array(a);
}
function concat(arraybuffers) {
    const sz = arraybuffers.reduce((sum, a)=>sum + a.byteLength
    , 0);
    const buf = new ArrayBuffer(sz);
    const cat = new Uint8Array(buf);
    let offset = 0;
    for (const a1 of arraybuffers){
        const v = new Uint8Array(a1);
        cat.set(v, offset);
        offset += a1.byteLength;
    }
    return buf;
}
function concatBuf(these) {
    return Buffer.concat(these);
}
"use strict";
function toString(type) {
    switch(type){
        case 1:
            return "A";
        case 10:
            return "NULL";
        case 28:
            return "AAAA";
        case 18:
            return "AFSDB";
        case 42:
            return "APL";
        case 257:
            return "CAA";
        case 60:
            return "CDNSKEY";
        case 59:
            return "CDS";
        case 37:
            return "CERT";
        case 5:
            return "CNAME";
        case 49:
            return "DHCID";
        case 32769:
            return "DLV";
        case 39:
            return "DNAME";
        case 48:
            return "DNSKEY";
        case 43:
            return "DS";
        case 55:
            return "HIP";
        case 13:
            return "HINFO";
        case 45:
            return "IPSECKEY";
        case 25:
            return "KEY";
        case 36:
            return "KX";
        case 29:
            return "LOC";
        case 15:
            return "MX";
        case 35:
            return "NAPTR";
        case 2:
            return "NS";
        case 47:
            return "NSEC";
        case 50:
            return "NSEC3";
        case 51:
            return "NSEC3PARAM";
        case 12:
            return "PTR";
        case 46:
            return "RRSIG";
        case 17:
            return "RP";
        case 24:
            return "SIG";
        case 6:
            return "SOA";
        case 99:
            return "SPF";
        case 33:
            return "SRV";
        case 44:
            return "SSHFP";
        case 32768:
            return "TA";
        case 249:
            return "TKEY";
        case 52:
            return "TLSA";
        case 250:
            return "TSIG";
        case 16:
            return "TXT";
        case 252:
            return "AXFR";
        case 251:
            return "IXFR";
        case 41:
            return "OPT";
        case 255:
            return "ANY";
        case 64:
            return "SVCB";
        case 65:
            return "HTTPS";
    }
    return "UNKNOWN_" + type;
}
function toType(name6) {
    switch(name6.toUpperCase()){
        case "A":
            return 1;
        case "NULL":
            return 10;
        case "AAAA":
            return 28;
        case "AFSDB":
            return 18;
        case "APL":
            return 42;
        case "CAA":
            return 257;
        case "CDNSKEY":
            return 60;
        case "CDS":
            return 59;
        case "CERT":
            return 37;
        case "CNAME":
            return 5;
        case "DHCID":
            return 49;
        case "DLV":
            return 32769;
        case "DNAME":
            return 39;
        case "DNSKEY":
            return 48;
        case "DS":
            return 43;
        case "HIP":
            return 55;
        case "HINFO":
            return 13;
        case "IPSECKEY":
            return 45;
        case "KEY":
            return 25;
        case "KX":
            return 36;
        case "LOC":
            return 29;
        case "MX":
            return 15;
        case "NAPTR":
            return 35;
        case "NS":
            return 2;
        case "NSEC":
            return 47;
        case "NSEC3":
            return 50;
        case "NSEC3PARAM":
            return 51;
        case "PTR":
            return 12;
        case "RRSIG":
            return 46;
        case "RP":
            return 17;
        case "SIG":
            return 24;
        case "SOA":
            return 6;
        case "SPF":
            return 99;
        case "SRV":
            return 33;
        case "SSHFP":
            return 44;
        case "TA":
            return 32768;
        case "TKEY":
            return 249;
        case "TLSA":
            return 52;
        case "TSIG":
            return 250;
        case "TXT":
            return 16;
        case "AXFR":
            return 252;
        case "IXFR":
            return 251;
        case "OPT":
            return 41;
        case "ANY":
            return 255;
        case "*":
            return 255;
        case "SVCB":
            return 64;
        case "HTTPS":
            return 65;
    }
    if (name6.toUpperCase().startsWith("UNKNOWN_")) return parseInt(name6.slice(8));
    return 0;
}
"use strict";
function toString1(rcode) {
    switch(rcode){
        case 0:
            return "NOERROR";
        case 1:
            return "FORMERR";
        case 2:
            return "SERVFAIL";
        case 3:
            return "NXDOMAIN";
        case 4:
            return "NOTIMP";
        case 5:
            return "REFUSED";
        case 6:
            return "YXDOMAIN";
        case 7:
            return "YXRRSET";
        case 8:
            return "NXRRSET";
        case 9:
            return "NOTAUTH";
        case 10:
            return "NOTZONE";
        case 11:
            return "RCODE_11";
        case 12:
            return "RCODE_12";
        case 13:
            return "RCODE_13";
        case 14:
            return "RCODE_14";
        case 15:
            return "RCODE_15";
    }
    return "RCODE_" + rcode;
}
"use strict";
function toString2(opcode) {
    switch(opcode){
        case 0:
            return "QUERY";
        case 1:
            return "IQUERY";
        case 2:
            return "STATUS";
        case 3:
            return "OPCODE_3";
        case 4:
            return "NOTIFY";
        case 5:
            return "UPDATE";
        case 6:
            return "OPCODE_6";
        case 7:
            return "OPCODE_7";
        case 8:
            return "OPCODE_8";
        case 9:
            return "OPCODE_9";
        case 10:
            return "OPCODE_10";
        case 11:
            return "OPCODE_11";
        case 12:
            return "OPCODE_12";
        case 13:
            return "OPCODE_13";
        case 14:
            return "OPCODE_14";
        case 15:
            return "OPCODE_15";
    }
    return "OPCODE_" + opcode;
}
"use strict";
function toString3(klass) {
    switch(klass){
        case 1:
            return "IN";
        case 2:
            return "CS";
        case 3:
            return "CH";
        case 4:
            return "HS";
        case 255:
            return "ANY";
    }
    return "UNKNOWN_" + klass;
}
function toClass(name7) {
    switch(name7.toUpperCase()){
        case "IN":
            return 1;
        case "CS":
            return 2;
        case "CH":
            return 3;
        case "HS":
            return 4;
        case "ANY":
            return 255;
    }
    return 0;
}
"use strict";
function toString4(type) {
    switch(type){
        case 1:
            return "LLQ";
        case 2:
            return "UL";
        case 3:
            return "NSID";
        case 5:
            return "DAU";
        case 6:
            return "DHU";
        case 7:
            return "N3U";
        case 8:
            return "CLIENT_SUBNET";
        case 9:
            return "EXPIRE";
        case 10:
            return "COOKIE";
        case 11:
            return "TCP_KEEPALIVE";
        case 12:
            return "PADDING";
        case 13:
            return "CHAIN";
        case 14:
            return "KEY_TAG";
        case 26946:
            return "DEVICEID";
    }
    if (type < 0) {
        return null;
    }
    return `OPTION_${type}`;
}
function toCode(name8) {
    if (typeof name8 === "number") {
        return name8;
    }
    if (!name8) {
        return -1;
    }
    switch(name8.toUpperCase()){
        case "OPTION_0":
            return 0;
        case "LLQ":
            return 1;
        case "UL":
            return 2;
        case "NSID":
            return 3;
        case "OPTION_4":
            return 4;
        case "DAU":
            return 5;
        case "DHU":
            return 6;
        case "N3U":
            return 7;
        case "CLIENT_SUBNET":
            return 8;
        case "EXPIRE":
            return 9;
        case "COOKIE":
            return 10;
        case "TCP_KEEPALIVE":
            return 11;
        case "PADDING":
            return 12;
        case "CHAIN":
            return 13;
        case "KEY_TAG":
            return 14;
        case "DEVICEID":
            return 26946;
        case "OPTION_65535":
            return 65535;
    }
    const m = name8.match(/_(\d+)$/);
    if (m) {
        return parseInt(m[1], 10);
    }
    return -1;
}
"use strict";
function toString5(type) {
    switch(type){
        case 0:
            return "mandatory";
        case 1:
            return "alpn";
        case 2:
            return "no-default-alpn";
        case 3:
            return "port";
        case 4:
            return "ipv4hint";
        case 5:
            return "ech";
        case 6:
            return "ipv6hint";
    }
    return "key" + type;
}
function toKey(name9) {
    switch(name9.toLowerCase()){
        case "mandatory":
            return 0;
        case "alpn":
            return 1;
        case "no-default-alpn":
            return 2;
        case "port":
            return 3;
        case "ipv4hint":
            return 4;
        case "ech":
            return 5;
        case "ipv6hint":
            return 6;
    }
    if (name9.toLowerCase().startsWith("key")) return parseInt(name9.slice(3));
    throw "Invalid svcparam key";
}
"use strict";
const ip = {};
ip.toBuffer = function(ip1, buff, offset) {
    offset = ~~offset;
    var result;
    if (this.isV4Format(ip1)) {
        result = buff || new Buffer(offset + 4);
        ip1.split(/\./g).map(function(__byte) {
            result[offset++] = parseInt(__byte, 10) & 255;
        });
    } else if (this.isV6Format(ip1)) {
        var sections = ip1.split(":", 8);
        var i8;
        for(i8 = 0; i8 < sections.length; i8++){
            var isv4 = this.isV4Format(sections[i8]);
            var v4Buffer;
            if (isv4) {
                v4Buffer = this.toBuffer(sections[i8]);
                sections[i8] = v4Buffer.slice(0, 2).toString("hex");
            }
            if (v4Buffer && ++i8 < 8) {
                sections.splice(i8, 0, v4Buffer.slice(2, 4).toString("hex"));
            }
        }
        if (sections[0] === "") {
            while(sections.length < 8)sections.unshift("0");
        } else if (sections[sections.length - 1] === "") {
            while(sections.length < 8)sections.push("0");
        } else if (sections.length < 8) {
            for(i8 = 0; i8 < sections.length && sections[i8] !== ""; i8++);
            var argv = [
                i8,
                1
            ];
            for(i8 = 9 - sections.length; i8 > 0; i8--){
                argv.push("0");
            }
            sections.splice.apply(sections, argv);
        }
        result = buff || new Buffer(offset + 16);
        for(i8 = 0; i8 < sections.length; i8++){
            var word = parseInt(sections[i8], 16);
            result[offset++] = word >> 8 & 255;
            result[offset++] = word & 255;
        }
    }
    if (!result) {
        throw Error("Invalid ip address: " + ip1);
    }
    return result;
};
ip.toString = function(buff, offset, length) {
    offset = ~~offset;
    length = length || buff.length - offset;
    var result = [];
    if (length === 4) {
        for(var i9 = 0; i9 < length; i9++){
            result.push(buff[offset + i9]);
        }
        result = result.join(".");
    } else if (length === 16) {
        for(var i9 = 0; i9 < length; i9 += 2){
            result.push(buff.readUInt16BE(offset + i9).toString(16));
        }
        result = result.join(":");
        result = result.replace(/(^|:)0(:0)*:0(:|$)/, "$1::$3");
        result = result.replace(/:{3,4}/, "::");
    }
    return result;
};
var ipv4Regex = /^(\d{1,3}\.){3,3}\d{1,3}$/;
var ipv6Regex = /^(::)?(((\d{1,3}\.){3}(\d{1,3}){1})?([0-9a-f]){0,4}:{0,2}){1,8}(::)?$/i;
ip.isV4Format = function(ip2) {
    return ipv4Regex.test(ip2);
};
ip.isV6Format = function(ip3) {
    return ipv6Regex.test(ip3);
};
function _normalizeFamily(family) {
    return family ? family.toLowerCase() : "ipv4";
}
ip.fromPrefixLen = function(prefixlen, family) {
    if (prefixlen > 32) {
        family = "ipv6";
    } else {
        family = _normalizeFamily(family);
    }
    var len = 4;
    if (family === "ipv6") {
        len = 16;
    }
    var buff = new Buffer(len);
    for(var i10 = 0, n = buff.length; i10 < n; ++i10){
        var bits = 8;
        if (prefixlen < 8) {
            bits = prefixlen;
        }
        prefixlen -= bits;
        buff[i10] = ~(255 >> bits) & 255;
    }
    return ip.toString(buff);
};
ip.mask = function(addr, mask) {
    addr = ip.toBuffer(addr);
    mask = ip.toBuffer(mask);
    var result = new Buffer(Math.max(addr.length, mask.length));
    var i11 = 0;
    if (addr.length === mask.length) {
        for(i11 = 0; i11 < addr.length; i11++){
            result[i11] = addr[i11] & mask[i11];
        }
    } else if (mask.length === 4) {
        for(i11 = 0; i11 < mask.length; i11++){
            result[i11] = addr[addr.length - 4 + i11] & mask[i11];
        }
    } else {
        for(var i11 = 0; i11 < result.length - 6; i11++){
            result[i11] = 0;
        }
        result[10] = 255;
        result[11] = 255;
        for(i11 = 0; i11 < addr.length; i11++){
            result[i11 + 12] = addr[i11] & mask[i11 + 12];
        }
        i11 = i11 + 12;
    }
    for(; i11 < result.length; i11++){
        result[i11] = 0;
    }
    return ip.toString(result);
};
ip.cidr = function(cidrString) {
    var cidrParts = cidrString.split("/");
    var addr = cidrParts[0];
    if (cidrParts.length !== 2) {
        throw new Error("invalid CIDR subnet: " + addr);
    }
    var mask = ip.fromPrefixLen(parseInt(cidrParts[1], 10));
    return ip.mask(addr, mask);
};
ip.subnet = function(addr, mask) {
    var networkAddress = ip.toLong(ip.mask(addr, mask));
    var maskBuffer = ip.toBuffer(mask);
    var maskLength = 0;
    for(var i12 = 0; i12 < maskBuffer.length; i12++){
        if (maskBuffer[i12] === 255) {
            maskLength += 8;
        } else {
            var octet = maskBuffer[i12] & 255;
            while(octet){
                octet = octet << 1 & 255;
                maskLength++;
            }
        }
    }
    var numberOfAddresses = Math.pow(2, 32 - maskLength);
    return {
        networkAddress: ip.fromLong(networkAddress),
        firstAddress: numberOfAddresses <= 2 ? ip.fromLong(networkAddress) : ip.fromLong(networkAddress + 1),
        lastAddress: numberOfAddresses <= 2 ? ip.fromLong(networkAddress + numberOfAddresses - 1) : ip.fromLong(networkAddress + numberOfAddresses - 2),
        broadcastAddress: ip.fromLong(networkAddress + numberOfAddresses - 1),
        subnetMask: mask,
        subnetMaskLength: maskLength,
        numHosts: numberOfAddresses <= 2 ? numberOfAddresses : numberOfAddresses - 2,
        length: numberOfAddresses,
        contains: function(other) {
            return networkAddress === ip.toLong(ip.mask(other, mask));
        }
    };
};
ip.cidrSubnet = function(cidrString) {
    var cidrParts = cidrString.split("/");
    var addr = cidrParts[0];
    if (cidrParts.length !== 2) {
        throw new Error("invalid CIDR subnet: " + addr);
    }
    var mask = ip.fromPrefixLen(parseInt(cidrParts[1], 10));
    return ip.subnet(addr, mask);
};
ip.not = function(addr) {
    var buff = ip.toBuffer(addr);
    for(var i13 = 0; i13 < buff.length; i13++){
        buff[i13] = 255 ^ buff[i13];
    }
    return ip.toString(buff);
};
ip.or = function(a, b) {
    a = ip.toBuffer(a);
    b = ip.toBuffer(b);
    if (a.length === b.length) {
        for(var i14 = 0; i14 < a.length; ++i14){
            a[i14] |= b[i14];
        }
        return ip.toString(a);
    } else {
        var buff = a;
        var other = b;
        if (b.length > a.length) {
            buff = b;
            other = a;
        }
        var offset = buff.length - other.length;
        for(var i14 = offset; i14 < buff.length; ++i14){
            buff[i14] |= other[i14 - offset];
        }
        return ip.toString(buff);
    }
};
ip.isEqual = function(a, b) {
    a = ip.toBuffer(a);
    b = ip.toBuffer(b);
    if (a.length === b.length) {
        for(var i15 = 0; i15 < a.length; i15++){
            if (a[i15] !== b[i15]) return false;
        }
        return true;
    }
    if (b.length === 4) {
        var t = b;
        b = a;
        a = t;
    }
    for(var i15 = 0; i15 < 10; i15++){
        if (b[i15] !== 0) return false;
    }
    var word = b.readUInt16BE(10);
    if (word !== 0 && word !== 65535) return false;
    for(var i15 = 0; i15 < 4; i15++){
        if (a[i15] !== b[i15 + 12]) return false;
    }
    return true;
};
ip.isPrivate = function(addr) {
    return /^(::f{4}:)?10\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/i.test(addr) || /^(::f{4}:)?192\.168\.([0-9]{1,3})\.([0-9]{1,3})$/i.test(addr) || /^(::f{4}:)?172\.(1[6-9]|2\d|30|31)\.([0-9]{1,3})\.([0-9]{1,3})$/i.test(addr) || /^(::f{4}:)?127\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/i.test(addr) || /^(::f{4}:)?169\.254\.([0-9]{1,3})\.([0-9]{1,3})$/i.test(addr) || /^f[cd][0-9a-f]{2}:/i.test(addr) || /^fe80:/i.test(addr) || /^::1$/.test(addr) || /^::$/.test(addr);
};
ip.isPublic = function(addr) {
    return !ip.isPrivate(addr);
};
ip.isLoopback = function(addr) {
    return /^(::f{4}:)?127\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})/.test(addr) || /^fe80::1$/.test(addr) || /^::1$/.test(addr) || /^::$/.test(addr);
};
ip.loopback = function(family) {
    family = _normalizeFamily(family);
    if (family !== "ipv4" && family !== "ipv6") {
        throw new Error("family must be ipv4 or ipv6");
    }
    return family === "ipv4" ? "127.0.0.1" : "fe80::1";
};
ip.toLong = function(ip4) {
    var ipl = 0;
    ip4.split(".").forEach(function(octet) {
        ipl <<= 8;
        ipl += parseInt(octet);
    });
    return ipl >>> 0;
};
ip.fromLong = function(ipl) {
    return (ipl >>> 24) + "." + (ipl >> 16 & 255) + "." + (ipl >> 8 & 255) + "." + (ipl & 255);
};
"use strict";
const QUERY_FLAG = 0;
const RESPONSE_FLAG = 1 << 15;
const FLUSH_MASK = 1 << 15;
const NOT_FLUSH_MASK = ~FLUSH_MASK;
const QU_MASK = 1 << 15;
const NOT_QU_MASK = ~QU_MASK;
const name = {};
name.encode = function(str, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(name.encodingLength(str));
    if (!offset) offset = 0;
    const oldOffset = offset;
    const n = str.replace(/^\.|\.$/gm, "");
    if (n.length) {
        const list = n.split(".");
        for(let i16 = 0; i16 < list.length; i16++){
            const len = buf.write(list[i16], offset + 1);
            buf[offset] = len;
            offset += len + 1;
        }
    }
    buf[offset++] = 0;
    name.encode.bytes = offset - oldOffset;
    return buf;
};
name.encode.bytes = 0;
name.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const list = [];
    const oldOffset = offset;
    let len = buf[offset++];
    if (len === 0) {
        name.decode.bytes = 1;
        return ".";
    }
    if (len >= 192) {
        const res = name.decode(buf, buf.readUInt16BE(offset - 1) - 49152);
        name.decode.bytes = 2;
        return res;
    }
    while(len){
        if (len >= 192) {
            list.push(name.decode(buf, buf.readUInt16BE(offset - 1) - 49152));
            offset++;
            break;
        }
        list.push(buf.toString("utf-8", offset, offset + len));
        offset += len;
        len = buf[offset++];
    }
    name.decode.bytes = offset - oldOffset;
    return list.join(".");
};
name.decode.bytes = 0;
name.encodingLength = function(n) {
    if (n === ".") return 1;
    return Buffer.byteLength(n) + 2;
};
const string = {};
string.encode = function(s, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(string.encodingLength(s));
    if (!offset) offset = 0;
    const len = buf.write(s, offset + 1);
    buf[offset] = len;
    string.encode.bytes = len + 1;
    return buf;
};
string.encode.bytes = 0;
string.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const len = buf[offset];
    const s = buf.toString("utf-8", offset + 1, offset + 1 + len);
    string.decode.bytes = len + 1;
    return s;
};
string.decode.bytes = 0;
string.encodingLength = function(s) {
    return Buffer.byteLength(s) + 1;
};
const header = {};
header.encode = function(h, buf, offset) {
    if (!buf) buf = header.encodingLength(h);
    if (!offset) offset = 0;
    const flags = (h.flags || 0) & 32767;
    const type = h.type === "response" ? RESPONSE_FLAG : QUERY_FLAG;
    buf.writeUInt16BE(h.id || 0, offset);
    buf.writeUInt16BE(flags | type, offset + 2);
    buf.writeUInt16BE(h.questions.length, offset + 4);
    buf.writeUInt16BE(h.answers.length, offset + 6);
    buf.writeUInt16BE(h.authorities.length, offset + 8);
    buf.writeUInt16BE(h.additionals.length, offset + 10);
    return buf;
};
header.encode.bytes = 12;
header.decode = function(buf, offset) {
    if (!offset) offset = 0;
    if (buf.length < 12) throw new Error("Header must be 12 bytes");
    const flags = buf.readUInt16BE(offset + 2);
    return {
        id: buf.readUInt16BE(offset),
        type: flags & RESPONSE_FLAG ? "response" : "query",
        flags: flags & 32767,
        flag_qr: (flags >> 15 & 1) === 1,
        opcode: toString2(flags >> 11 & 15),
        flag_aa: (flags >> 10 & 1) === 1,
        flag_tc: (flags >> 9 & 1) === 1,
        flag_rd: (flags >> 8 & 1) === 1,
        flag_ra: (flags >> 7 & 1) === 1,
        flag_z: (flags >> 6 & 1) === 1,
        flag_ad: (flags >> 5 & 1) === 1,
        flag_cd: (flags >> 4 & 1) === 1,
        rcode: toString1(flags & 15),
        questions: new Array(buf.readUInt16BE(offset + 4)),
        answers: new Array(buf.readUInt16BE(offset + 6)),
        authorities: new Array(buf.readUInt16BE(offset + 8)),
        additionals: new Array(buf.readUInt16BE(offset + 10))
    };
};
header.decode.bytes = 12;
header.encodingLength = function() {
    return 12;
};
const runknown = {};
runknown.encode = function(data, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(runknown.encodingLength(data));
    if (!offset) offset = 0;
    buf.writeUInt16BE(data.length, offset);
    data.copy(buf, offset + 2);
    runknown.encode.bytes = data.length + 2;
    return buf;
};
runknown.encode.bytes = 0;
runknown.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const len = buf.readUInt16BE(offset);
    const data = buf.slice(offset + 2, offset + 2 + len);
    runknown.decode.bytes = len + 2;
    return data;
};
runknown.decode.bytes = 0;
runknown.encodingLength = function(data) {
    return data.length + 2;
};
const rns = {};
rns.encode = function(data, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(rns.encodingLength(data));
    if (!offset) offset = 0;
    name.encode(data, buf, offset + 2);
    buf.writeUInt16BE(name.encode.bytes, offset);
    rns.encode.bytes = name.encode.bytes + 2;
    return buf;
};
rns.encode.bytes = 0;
rns.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const len = buf.readUInt16BE(offset);
    const dd = name.decode(buf, offset + 2);
    rns.decode.bytes = len + 2;
    return dd;
};
rns.decode.bytes = 0;
rns.encodingLength = function(data) {
    return name.encodingLength(data) + 2;
};
const rsoa = {};
rsoa.encode = function(data, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(rsoa.encodingLength(data));
    if (!offset) offset = 0;
    const oldOffset = offset;
    offset += 2;
    name.encode(data.mname, buf, offset);
    offset += name.encode.bytes;
    name.encode(data.rname, buf, offset);
    offset += name.encode.bytes;
    buf.writeUInt32BE(data.serial || 0, offset);
    offset += 4;
    buf.writeUInt32BE(data.refresh || 0, offset);
    offset += 4;
    buf.writeUInt32BE(data.retry || 0, offset);
    offset += 4;
    buf.writeUInt32BE(data.expire || 0, offset);
    offset += 4;
    buf.writeUInt32BE(data.minimum || 0, offset);
    offset += 4;
    buf.writeUInt16BE(offset - oldOffset - 2, oldOffset);
    rsoa.encode.bytes = offset - oldOffset;
    return buf;
};
rsoa.encode.bytes = 0;
rsoa.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const oldOffset = offset;
    const data = {};
    offset += 2;
    data.mname = name.decode(buf, offset);
    offset += name.decode.bytes;
    data.rname = name.decode(buf, offset);
    offset += name.decode.bytes;
    data.serial = buf.readUInt32BE(offset);
    offset += 4;
    data.refresh = buf.readUInt32BE(offset);
    offset += 4;
    data.retry = buf.readUInt32BE(offset);
    offset += 4;
    data.expire = buf.readUInt32BE(offset);
    offset += 4;
    data.minimum = buf.readUInt32BE(offset);
    offset += 4;
    rsoa.decode.bytes = offset - oldOffset;
    return data;
};
rsoa.decode.bytes = 0;
rsoa.encodingLength = function(data) {
    return 22 + name.encodingLength(data.mname) + name.encodingLength(data.rname);
};
const rtxt = {};
rtxt.encode = function(data, buf, offset) {
    if (!Array.isArray(data)) data = [
        data
    ];
    for(let i17 = 0; i17 < data.length; i17++){
        if (typeof data[i17] === "string") {
            data[i17] = Buffer.from(data[i17]);
        }
        if (!Buffer.isBuffer(data[i17])) {
            throw new Error("Must be a Buffer");
        }
    }
    if (!buf) buf = Buffer.allocUnsafe(rtxt.encodingLength(data));
    if (!offset) offset = 0;
    const oldOffset = offset;
    offset += 2;
    data.forEach(function(d) {
        buf[offset++] = d.length;
        d.copy(buf, offset, 0, d.length);
        offset += d.length;
    });
    buf.writeUInt16BE(offset - oldOffset - 2, oldOffset);
    rtxt.encode.bytes = offset - oldOffset;
    return buf;
};
rtxt.encode.bytes = 0;
rtxt.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const oldOffset = offset;
    let remaining = buf.readUInt16BE(offset);
    offset += 2;
    let data = [];
    while(remaining > 0){
        const len = buf[offset++];
        --remaining;
        if (remaining < len) {
            throw new Error("Buffer overflow");
        }
        data.push(buf.slice(offset, offset + len));
        offset += len;
        remaining -= len;
    }
    rtxt.decode.bytes = offset - oldOffset;
    return data;
};
rtxt.decode.bytes = 0;
rtxt.encodingLength = function(data) {
    if (!Array.isArray(data)) data = [
        data
    ];
    let length = 2;
    data.forEach(function(buf) {
        if (typeof buf === "string") {
            length += Buffer.byteLength(buf) + 1;
        } else {
            length += buf.length + 1;
        }
    });
    return length;
};
const rnull = {};
rnull.encode = function(data, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(rnull.encodingLength(data));
    if (!offset) offset = 0;
    if (typeof data === "string") data = Buffer.from(data);
    if (!data) data = Buffer.allocUnsafe(0);
    const oldOffset = offset;
    offset += 2;
    const len = data.length;
    data.copy(buf, offset, 0, len);
    offset += len;
    buf.writeUInt16BE(offset - oldOffset - 2, oldOffset);
    rnull.encode.bytes = offset - oldOffset;
    return buf;
};
rnull.encode.bytes = 0;
rnull.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const oldOffset = offset;
    const len = buf.readUInt16BE(offset);
    offset += 2;
    const data = buf.slice(offset, offset + len);
    offset += len;
    rnull.decode.bytes = offset - oldOffset;
    return data;
};
rnull.decode.bytes = 0;
rnull.encodingLength = function(data) {
    if (!data) return 2;
    return (Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data)) + 2;
};
const rhinfo = {};
rhinfo.encode = function(data, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(rhinfo.encodingLength(data));
    if (!offset) offset = 0;
    const oldOffset = offset;
    offset += 2;
    string.encode(data.cpu, buf, offset);
    offset += string.encode.bytes;
    string.encode(data.os, buf, offset);
    offset += string.encode.bytes;
    buf.writeUInt16BE(offset - oldOffset - 2, oldOffset);
    rhinfo.encode.bytes = offset - oldOffset;
    return buf;
};
rhinfo.encode.bytes = 0;
rhinfo.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const oldOffset = offset;
    const data = {};
    offset += 2;
    data.cpu = string.decode(buf, offset);
    offset += string.decode.bytes;
    data.os = string.decode(buf, offset);
    offset += string.decode.bytes;
    rhinfo.decode.bytes = offset - oldOffset;
    return data;
};
rhinfo.decode.bytes = 0;
rhinfo.encodingLength = function(data) {
    return string.encodingLength(data.cpu) + string.encodingLength(data.os) + 2;
};
const rptr = {};
const rcname = rptr;
const rdname = rptr;
rptr.encode = function(data, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(rptr.encodingLength(data));
    if (!offset) offset = 0;
    name.encode(data, buf, offset + 2);
    buf.writeUInt16BE(name.encode.bytes, offset);
    rptr.encode.bytes = name.encode.bytes + 2;
    return buf;
};
rptr.encode.bytes = 0;
rptr.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const data = name.decode(buf, offset + 2);
    rptr.decode.bytes = name.decode.bytes + 2;
    return data;
};
rptr.decode.bytes = 0;
rptr.encodingLength = function(data) {
    return name.encodingLength(data) + 2;
};
const rsrv = {};
rsrv.encode = function(data, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(rsrv.encodingLength(data));
    if (!offset) offset = 0;
    buf.writeUInt16BE(data.priority || 0, offset + 2);
    buf.writeUInt16BE(data.weight || 0, offset + 4);
    buf.writeUInt16BE(data.port || 0, offset + 6);
    name.encode(data.target, buf, offset + 8);
    const len = name.encode.bytes + 6;
    buf.writeUInt16BE(len, offset);
    rsrv.encode.bytes = len + 2;
    return buf;
};
rsrv.encode.bytes = 0;
rsrv.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const len = buf.readUInt16BE(offset);
    const data = {};
    data.priority = buf.readUInt16BE(offset + 2);
    data.weight = buf.readUInt16BE(offset + 4);
    data.port = buf.readUInt16BE(offset + 6);
    data.target = name.decode(buf, offset + 8);
    rsrv.decode.bytes = len + 2;
    return data;
};
rsrv.decode.bytes = 0;
rsrv.encodingLength = function(data) {
    return 8 + name.encodingLength(data.target);
};
const rcaa = {};
rcaa.ISSUER_CRITICAL = 1 << 7;
rcaa.encode = function(data, buf, offset) {
    const len = rcaa.encodingLength(data);
    if (!buf) buf = Buffer.allocUnsafe(rcaa.encodingLength(data));
    if (!offset) offset = 0;
    if (data.issuerCritical) {
        data.flags = rcaa.ISSUER_CRITICAL;
    }
    buf.writeUInt16BE(len - 2, offset);
    offset += 2;
    buf.writeUInt8(data.flags || 0, offset);
    offset += 1;
    string.encode(data.tag, buf, offset);
    offset += string.encode.bytes;
    buf.write(data.value, offset);
    offset += Buffer.byteLength(data.value);
    rcaa.encode.bytes = len;
    return buf;
};
rcaa.encode.bytes = 0;
rcaa.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const len = buf.readUInt16BE(offset);
    offset += 2;
    const oldOffset = offset;
    const data = {};
    data.flags = buf.readUInt8(offset);
    offset += 1;
    data.tag = string.decode(buf, offset);
    offset += string.decode.bytes;
    data.value = buf.toString("utf-8", offset, oldOffset + len);
    data.issuerCritical = !!(data.flags & rcaa.ISSUER_CRITICAL);
    rcaa.decode.bytes = len + 2;
    return data;
};
rcaa.decode.bytes = 0;
rcaa.encodingLength = function(data) {
    return string.encodingLength(data.tag) + string.encodingLength(data.value) + 2;
};
const rmx = {};
rmx.encode = function(data, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(rmx.encodingLength(data));
    if (!offset) offset = 0;
    const oldOffset = offset;
    offset += 2;
    buf.writeUInt16BE(data.preference || 0, offset);
    offset += 2;
    name.encode(data.exchange, buf, offset);
    offset += name.encode.bytes;
    buf.writeUInt16BE(offset - oldOffset - 2, oldOffset);
    rmx.encode.bytes = offset - oldOffset;
    return buf;
};
rmx.encode.bytes = 0;
rmx.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const oldOffset = offset;
    const data = {};
    offset += 2;
    data.preference = buf.readUInt16BE(offset);
    offset += 2;
    data.exchange = name.decode(buf, offset);
    offset += name.decode.bytes;
    rmx.decode.bytes = offset - oldOffset;
    return data;
};
rmx.encodingLength = function(data) {
    return 4 + name.encodingLength(data.exchange);
};
const ra = {};
ra.encode = function(host, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(ra.encodingLength(host));
    if (!offset) offset = 0;
    buf.writeUInt16BE(4, offset);
    offset += 2;
    ip.toBuffer(host, buf, offset);
    ra.encode.bytes = 6;
    return buf;
};
ra.encode.bytes = 0;
ra.decode = function(buf, offset) {
    if (!offset) offset = 0;
    offset += 2;
    const host = ip.toString(buf, offset, 4);
    ra.decode.bytes = 6;
    return host;
};
ra.decode.bytes = 0;
ra.encodingLength = function() {
    return 6;
};
const raaaa = {};
raaaa.encode = function(host, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(raaaa.encodingLength(host));
    if (!offset) offset = 0;
    buf.writeUInt16BE(16, offset);
    offset += 2;
    ip.toBuffer(host, buf, offset);
    raaaa.encode.bytes = 18;
    return buf;
};
raaaa.encode.bytes = 0;
raaaa.decode = function(buf, offset) {
    if (!offset) offset = 0;
    offset += 2;
    const host = ip.toString(buf, offset, 16);
    raaaa.decode.bytes = 18;
    return host;
};
raaaa.decode.bytes = 0;
raaaa.encodingLength = function() {
    return 18;
};
const roption = {};
roption.encode = function(option, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(roption.encodingLength(option));
    if (!offset) offset = 0;
    const oldOffset = offset;
    const code = toCode(option.code);
    buf.writeUInt16BE(code, offset);
    offset += 2;
    if (option.data) {
        buf.writeUInt16BE(option.data.length, offset);
        offset += 2;
        option.data.copy(buf, offset);
        offset += option.data.length;
    } else {
        switch(code){
            case 8:
                const spl = option.sourcePrefixLength || 0;
                const fam = option.family || (ip.isV4Format(option.ip) ? 1 : 2);
                const ipBuf = ip.toBuffer(option.ip);
                const ipLen = Math.ceil(spl / 8);
                buf.writeUInt16BE(ipLen + 4, offset);
                offset += 2;
                buf.writeUInt16BE(fam, offset);
                offset += 2;
                buf.writeUInt8(spl, offset++);
                buf.writeUInt8(option.scopePrefixLength || 0, offset++);
                ipBuf.copy(buf, offset, 0, ipLen);
                offset += ipLen;
                break;
            case 11:
                if (option.timeout) {
                    buf.writeUInt16BE(2, offset);
                    offset += 2;
                    buf.writeUInt16BE(option.timeout, offset);
                    offset += 2;
                } else {
                    buf.writeUInt16BE(0, offset);
                    offset += 2;
                }
                break;
            case 12:
                const len = option.length || 0;
                buf.writeUInt16BE(len, offset);
                offset += 2;
                buf.fill(0, offset, offset + len);
                offset += len;
                break;
            case 14:
                const tagsLen = option.tags.length * 2;
                buf.writeUInt16BE(tagsLen, offset);
                offset += 2;
                for (const tag of option.tags){
                    buf.writeUInt16BE(tag, offset);
                    offset += 2;
                }
                break;
            default:
                throw new Error(`Unknown roption code: ${option.code}`);
        }
    }
    roption.encode.bytes = offset - oldOffset;
    return buf;
};
roption.encode.bytes = 0;
roption.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const option = {};
    option.code = buf.readUInt16BE(offset);
    option.type = toString4(option.code);
    offset += 2;
    const len = buf.readUInt16BE(offset);
    offset += 2;
    option.data = buf.slice(offset, offset + len);
    switch(option.code){
        case 8:
            option.family = buf.readUInt16BE(offset);
            offset += 2;
            option.sourcePrefixLength = buf.readUInt8(offset++);
            option.scopePrefixLength = buf.readUInt8(offset++);
            const padded = Buffer.alloc(option.family === 1 ? 4 : 16);
            buf.copy(padded, 0, offset, offset + len - 4);
            option.ip = ip.toString(padded);
            break;
        case 11:
            if (len > 0) {
                option.timeout = buf.readUInt16BE(offset);
                offset += 2;
            }
            break;
        case 14:
            option.tags = [];
            for(let i18 = 0; i18 < len; i18 += 2){
                option.tags.push(buf.readUInt16BE(offset));
                offset += 2;
            }
    }
    roption.decode.bytes = len + 4;
    return option;
};
roption.decode.bytes = 0;
roption.encodingLength = function(option) {
    if (option.data) {
        return option.data.length + 4;
    }
    const code = toCode(option.code);
    switch(code){
        case 8:
            const spl = option.sourcePrefixLength || 0;
            return Math.ceil(spl / 8) + 8;
        case 11:
            return typeof option.timeout === "number" ? 6 : 4;
        case 12:
            return option.length + 4;
        case 14:
            return 4 + option.tags.length * 2;
    }
    throw new Error(`Unknown roption code: ${option.code}`);
};
const ropt = {};
ropt.encode = function(options, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(ropt.encodingLength(options));
    if (!offset) offset = 0;
    const oldOffset = offset;
    const rdlen = encodingLengthList(options, roption);
    buf.writeUInt16BE(rdlen, offset);
    offset = encodeList(options, roption, buf, offset + 2);
    ropt.encode.bytes = offset - oldOffset;
    return buf;
};
ropt.encode.bytes = 0;
ropt.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const oldOffset = offset;
    const options = [];
    let rdlen = buf.readUInt16BE(offset);
    offset += 2;
    let o = 0;
    while(rdlen > 0){
        options[o++] = roption.decode(buf, offset);
        offset += roption.decode.bytes;
        rdlen -= roption.decode.bytes;
    }
    ropt.decode.bytes = offset - oldOffset;
    return options;
};
ropt.decode.bytes = 0;
ropt.encodingLength = function(options) {
    return 2 + encodingLengthList(options || [], roption);
};
const rdnskey = {};
rdnskey.PROTOCOL_DNSSEC = 3;
rdnskey.ZONE_KEY = 128;
rdnskey.SECURE_ENTRYPOINT = 32768;
rdnskey.encode = function(key, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(rdnskey.encodingLength(key));
    if (!offset) offset = 0;
    const oldOffset = offset;
    const keydata = key.key;
    if (!Buffer.isBuffer(keydata)) {
        throw new Error("Key must be a Buffer");
    }
    offset += 2;
    buf.writeUInt16BE(key.flags, offset);
    offset += 2;
    buf.writeUInt8(rdnskey.PROTOCOL_DNSSEC, offset);
    offset += 1;
    buf.writeUInt8(key.algorithm, offset);
    offset += 1;
    keydata.copy(buf, offset, 0, keydata.length);
    offset += keydata.length;
    rdnskey.encode.bytes = offset - oldOffset;
    buf.writeUInt16BE(rdnskey.encode.bytes - 2, oldOffset);
    return buf;
};
rdnskey.encode.bytes = 0;
rdnskey.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const oldOffset = offset;
    var key = {};
    var length = buf.readUInt16BE(offset);
    offset += 2;
    key.flags = buf.readUInt16BE(offset);
    offset += 2;
    if (buf.readUInt8(offset) !== rdnskey.PROTOCOL_DNSSEC) {
        throw new Error("Protocol must be 3");
    }
    offset += 1;
    key.algorithm = buf.readUInt8(offset);
    offset += 1;
    key.key = buf.slice(offset, oldOffset + length + 2);
    offset += key.key.length;
    rdnskey.decode.bytes = offset - oldOffset;
    return key;
};
rdnskey.decode.bytes = 0;
rdnskey.encodingLength = function(key) {
    return 6 + Buffer.byteLength(key.key);
};
const rrrsig = {};
rrrsig.encode = function(sig, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(rrrsig.encodingLength(sig));
    if (!offset) offset = 0;
    const oldOffset = offset;
    const signature = sig.signature;
    if (!Buffer.isBuffer(signature)) {
        throw new Error("Signature must be a Buffer");
    }
    offset += 2;
    buf.writeUInt16BE(toType(sig.typeCovered), offset);
    offset += 2;
    buf.writeUInt8(sig.algorithm, offset);
    offset += 1;
    buf.writeUInt8(sig.labels, offset);
    offset += 1;
    buf.writeUInt32BE(sig.originalTTL, offset);
    offset += 4;
    buf.writeUInt32BE(sig.expiration, offset);
    offset += 4;
    buf.writeUInt32BE(sig.inception, offset);
    offset += 4;
    buf.writeUInt16BE(sig.keyTag, offset);
    offset += 2;
    name.encode(sig.signersName, buf, offset);
    offset += name.encode.bytes;
    signature.copy(buf, offset, 0, signature.length);
    offset += signature.length;
    rrrsig.encode.bytes = offset - oldOffset;
    buf.writeUInt16BE(rrrsig.encode.bytes - 2, oldOffset);
    return buf;
};
rrrsig.encode.bytes = 0;
rrrsig.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const oldOffset = offset;
    var sig = {};
    var length = buf.readUInt16BE(offset);
    offset += 2;
    sig.typeCovered = toString(buf.readUInt16BE(offset));
    offset += 2;
    sig.algorithm = buf.readUInt8(offset);
    offset += 1;
    sig.labels = buf.readUInt8(offset);
    offset += 1;
    sig.originalTTL = buf.readUInt32BE(offset);
    offset += 4;
    sig.expiration = buf.readUInt32BE(offset);
    offset += 4;
    sig.inception = buf.readUInt32BE(offset);
    offset += 4;
    sig.keyTag = buf.readUInt16BE(offset);
    offset += 2;
    sig.signersName = name.decode(buf, offset);
    offset += name.decode.bytes;
    sig.signature = buf.slice(offset, oldOffset + length + 2);
    offset += sig.signature.length;
    rrrsig.decode.bytes = offset - oldOffset;
    return sig;
};
rrrsig.decode.bytes = 0;
rrrsig.encodingLength = function(sig) {
    return 20 + name.encodingLength(sig.signersName) + Buffer.byteLength(sig.signature);
};
const rrp = {};
rrp.encode = function(data, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(rrp.encodingLength(data));
    if (!offset) offset = 0;
    const oldOffset = offset;
    offset += 2;
    name.encode(data.mbox || ".", buf, offset);
    offset += name.encode.bytes;
    name.encode(data.txt || ".", buf, offset);
    offset += name.encode.bytes;
    rrp.encode.bytes = offset - oldOffset;
    buf.writeUInt16BE(rrp.encode.bytes - 2, oldOffset);
    return buf;
};
rrp.encode.bytes = 0;
rrp.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const oldOffset = offset;
    const data = {};
    offset += 2;
    data.mbox = name.decode(buf, offset) || ".";
    offset += name.decode.bytes;
    data.txt = name.decode(buf, offset) || ".";
    offset += name.decode.bytes;
    rrp.decode.bytes = offset - oldOffset;
    return data;
};
rrp.decode.bytes = 0;
rrp.encodingLength = function(data) {
    return 2 + name.encodingLength(data.mbox || ".") + name.encodingLength(data.txt || ".");
};
const typebitmap = {};
typebitmap.encode = function(typelist, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(typebitmap.encodingLength(typelist));
    if (!offset) offset = 0;
    const oldOffset = offset;
    var typesByWindow = [];
    for(var i19 = 0; i19 < typelist.length; i19++){
        var typeid = toType(typelist[i19]);
        if (typesByWindow[typeid >> 8] === undefined) {
            typesByWindow[typeid >> 8] = [];
        }
        typesByWindow[typeid >> 8][typeid >> 3 & 31] |= 1 << 7 - (typeid & 7);
    }
    for(i19 = 0; i19 < typesByWindow.length; i19++){
        if (typesByWindow[i19] !== undefined) {
            var windowBuf = Buffer.from(typesByWindow[i19]);
            buf.writeUInt8(i19, offset);
            offset += 1;
            buf.writeUInt8(windowBuf.length, offset);
            offset += 1;
            windowBuf.copy(buf, offset);
            offset += windowBuf.length;
        }
    }
    typebitmap.encode.bytes = offset - oldOffset;
    return buf;
};
typebitmap.encode.bytes = 0;
typebitmap.decode = function(buf, offset, length) {
    if (!offset) offset = 0;
    const oldOffset = offset;
    var typelist = [];
    while(offset - oldOffset < length){
        var window = buf.readUInt8(offset);
        offset += 1;
        var windowLength = buf.readUInt8(offset);
        offset += 1;
        for(var i20 = 0; i20 < windowLength; i20++){
            var b = buf.readUInt8(offset + i20);
            for(var j = 0; j < 8; j++){
                if (b & 1 << 7 - j) {
                    var typeid = toString(window << 8 | i20 << 3 | j);
                    typelist.push(typeid);
                }
            }
        }
        offset += windowLength;
    }
    typebitmap.decode.bytes = offset - oldOffset;
    return typelist;
};
typebitmap.decode.bytes = 0;
typebitmap.encodingLength = function(typelist) {
    var extents = [];
    for(var i21 = 0; i21 < typelist.length; i21++){
        var typeid = toType(typelist[i21]);
        extents[typeid >> 8] = Math.max(extents[typeid >> 8] || 0, typeid & 255);
    }
    var len = 0;
    for(i21 = 0; i21 < extents.length; i21++){
        if (extents[i21] !== undefined) {
            len += 2 + Math.ceil((extents[i21] + 1) / 8);
        }
    }
    return len;
};
const rnsec = {};
rnsec.encode = function(record, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(rnsec.encodingLength(record));
    if (!offset) offset = 0;
    const oldOffset = offset;
    offset += 2;
    name.encode(record.nextDomain, buf, offset);
    offset += name.encode.bytes;
    typebitmap.encode(record.rrtypes, buf, offset);
    offset += typebitmap.encode.bytes;
    rnsec.encode.bytes = offset - oldOffset;
    buf.writeUInt16BE(rnsec.encode.bytes - 2, oldOffset);
    return buf;
};
rnsec.encode.bytes = 0;
rnsec.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const oldOffset = offset;
    var record = {};
    var length = buf.readUInt16BE(offset);
    offset += 2;
    record.nextDomain = name.decode(buf, offset);
    offset += name.decode.bytes;
    record.rrtypes = typebitmap.decode(buf, offset, length - (offset - oldOffset));
    offset += typebitmap.decode.bytes;
    rnsec.decode.bytes = offset - oldOffset;
    return record;
};
rnsec.decode.bytes = 0;
rnsec.encodingLength = function(record) {
    return 2 + name.encodingLength(record.nextDomain) + typebitmap.encodingLength(record.rrtypes);
};
const rnsec3 = {};
rnsec3.encode = function(record, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(rnsec3.encodingLength(record));
    if (!offset) offset = 0;
    const oldOffset = offset;
    const salt = record.salt;
    if (!Buffer.isBuffer(salt)) {
        throw new Error("salt must be a Buffer");
    }
    const nextDomain = record.nextDomain;
    if (!Buffer.isBuffer(nextDomain)) {
        throw new Error("nextDomain must be a Buffer");
    }
    offset += 2;
    buf.writeUInt8(record.algorithm, offset);
    offset += 1;
    buf.writeUInt8(record.flags, offset);
    offset += 1;
    buf.writeUInt16BE(record.iterations, offset);
    offset += 2;
    buf.writeUInt8(salt.length, offset);
    offset += 1;
    salt.copy(buf, offset, 0, salt.length);
    offset += salt.length;
    buf.writeUInt8(nextDomain.length, offset);
    offset += 1;
    nextDomain.copy(buf, offset, 0, nextDomain.length);
    offset += nextDomain.length;
    typebitmap.encode(record.rrtypes, buf, offset);
    offset += typebitmap.encode.bytes;
    rnsec3.encode.bytes = offset - oldOffset;
    buf.writeUInt16BE(rnsec3.encode.bytes - 2, oldOffset);
    return buf;
};
rnsec3.encode.bytes = 0;
rnsec3.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const oldOffset = offset;
    var record = {};
    var length = buf.readUInt16BE(offset);
    offset += 2;
    record.algorithm = buf.readUInt8(offset);
    offset += 1;
    record.flags = buf.readUInt8(offset);
    offset += 1;
    record.iterations = buf.readUInt16BE(offset);
    offset += 2;
    const saltLength = buf.readUInt8(offset);
    offset += 1;
    record.salt = buf.slice(offset, offset + saltLength);
    offset += saltLength;
    const hashLength = buf.readUInt8(offset);
    offset += 1;
    record.nextDomain = buf.slice(offset, offset + hashLength);
    offset += hashLength;
    record.rrtypes = typebitmap.decode(buf, offset, length - (offset - oldOffset));
    offset += typebitmap.decode.bytes;
    rnsec3.decode.bytes = offset - oldOffset;
    return record;
};
rnsec3.decode.bytes = 0;
rnsec3.encodingLength = function(record) {
    return 8 + record.salt.length + record.nextDomain.length + typebitmap.encodingLength(record.rrtypes);
};
const rds = {};
rds.encode = function(digest, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(rds.encodingLength(digest));
    if (!offset) offset = 0;
    const oldOffset = offset;
    const digestdata = digest.digest;
    if (!Buffer.isBuffer(digestdata)) {
        throw new Error("Digest must be a Buffer");
    }
    offset += 2;
    buf.writeUInt16BE(digest.keyTag, offset);
    offset += 2;
    buf.writeUInt8(digest.algorithm, offset);
    offset += 1;
    buf.writeUInt8(digest.digestType, offset);
    offset += 1;
    digestdata.copy(buf, offset, 0, digestdata.length);
    offset += digestdata.length;
    rds.encode.bytes = offset - oldOffset;
    buf.writeUInt16BE(rds.encode.bytes - 2, oldOffset);
    return buf;
};
rds.encode.bytes = 0;
rds.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const oldOffset = offset;
    var digest = {};
    var length = buf.readUInt16BE(offset);
    offset += 2;
    digest.keyTag = buf.readUInt16BE(offset);
    offset += 2;
    digest.algorithm = buf.readUInt8(offset);
    offset += 1;
    digest.digestType = buf.readUInt8(offset);
    offset += 1;
    digest.digest = buf.slice(offset, oldOffset + length + 2);
    offset += digest.digest.length;
    rds.decode.bytes = offset - oldOffset;
    return digest;
};
rds.decode.bytes = 0;
rds.encodingLength = function(digest) {
    return 6 + Buffer.byteLength(digest.digest);
};
const rhttpsvcb = {};
rhttpsvcb.decode = function(buf, offset) {
    if (!offset) offset = 0;
    let oldOffset = offset;
    const rLen = buf.readUInt16BE(offset) + 2;
    console.log("Rdata length : " + rLen);
    offset += 2;
    let data = {};
    data.svcPriority = buf.readUInt16BE(offset);
    offset += 2;
    data.targetName = name.decode(buf, offset);
    offset += name.decode.bytes;
    data.svcParams = {};
    let svcKeyDecode;
    let svcParamKey;
    let svcKeyStr;
    while(offset != oldOffset + rLen){
        svcParamKey = buf.readUInt16BE(offset);
        svcKeyStr = toString5(svcParamKey);
        svcKeyDecode = svcbKeyObj(svcKeyStr);
        offset += 2;
        data.svcParams[svcKeyStr] = svcKeyDecode.decode(buf, offset);
        offset += svcKeyDecode.decode.bytes;
    }
    rhttpsvcb.decode.bytes = offset - oldOffset;
    return data;
};
rhttpsvcb.decode.bytes = 0;
rhttpsvcb.encode = function(data, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(rhttpsvcb.encodingLength(data));
    if (!offset) offset = 0;
    const oldOffset = offset;
    offset += 2;
    buf.writeUInt16BE(data.svcPriority, offset);
    offset += 2;
    name.encode(data.targetName, buf, offset);
    offset += name.encode.bytes;
    let svcbObj;
    for (let key of Object.keys(data.svcParams)){
        buf.writeUInt16BE(toKey(key), offset);
        offset += 2;
        svcbObj = svcbKeyObj(key);
        svcbObj.encode(data.svcParams[key], buf, offset);
        offset += svcbObj.encode.bytes;
    }
    buf.writeUInt16BE(offset - oldOffset - 2, oldOffset);
    rhttpsvcb.encode.bytes = offset - oldOffset;
    return buf;
};
rhttpsvcb.encode.bytes = 0;
rhttpsvcb.encodingLength = function(data) {
    var encLen = 4 + name.encodingLength(data.targetName);
    let svcbObj;
    for (let key of Object.keys(data.svcParams)){
        svcbObj = svcbKeyObj(key);
        encLen += 2 + svcbObj.encodingLength(data.svcParams[key]);
    }
    console.log(encLen);
    return encLen;
};
const svcAlpn = {};
svcAlpn.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const oldOffset = offset;
    var data = [];
    var length = buf.readUInt16BE(offset);
    offset += 2;
    var valueLength = 0;
    while(length != 0){
        valueLength = buf.readUInt8(offset);
        offset += 1;
        length -= 1;
        data.push(buf.toString("utf-8", offset, offset + valueLength));
        offset += valueLength;
        length -= valueLength;
    }
    svcAlpn.decode.bytes = offset - oldOffset;
    return data;
};
svcAlpn.decode.bytes = 0;
svcAlpn.encode = function(data, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(svcAlpn.encodingLength(data));
    if (!offset) offset = 0;
    const oldOffset = offset;
    offset += 2;
    for (let value of data){
        buf.writeUInt8(Buffer.byteLength(value), offset);
        offset += 1;
        offset += buf.write(value, offset);
    }
    buf.writeUInt16BE(offset - oldOffset - 2, oldOffset);
    svcAlpn.encode.bytes = offset - oldOffset;
    return buf;
};
svcAlpn.encode.bytes = 0;
svcAlpn.encodingLength = function(data) {
    var encLen = 2;
    for (let value of data){
        encLen += 1 + Buffer.byteLength(value);
    }
    return encLen;
};
const svcIpv6 = {};
svcIpv6.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const oldOffset = offset;
    var data = [];
    var length = buf.readUInt16BE(offset);
    offset += 2;
    while(length != 0){
        data.push(ip.toString(buf, offset, 16));
        offset += 16;
        length -= 16;
    }
    svcIpv6.decode.bytes = offset - oldOffset;
    return data;
};
svcIpv6.decode.bytes = 0;
svcIpv6.encode = function(data, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(svcIpv6.encodingLength(data));
    if (!offset) offset = 0;
    const oldOffset = offset;
    buf.writeUInt16BE(data.length * 16, offset);
    offset += 2;
    for (let value of data){
        ip.toBuffer(value, buf, offset);
        offset += 16;
    }
    svcIpv6.encode.bytes = offset - oldOffset;
    return buf;
};
svcIpv6.encode.bytes = 0;
svcIpv6.encodingLength = function(data) {
    return 2 + data.length * 16;
};
const svcIpv4 = {};
svcIpv4.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const oldOffset = offset;
    var data = [];
    var length = buf.readUInt16BE(offset);
    offset += 2;
    while(length != 0){
        data.push(ip.toString(buf, offset, 4));
        offset += 4;
        length -= 4;
    }
    svcIpv4.decode.bytes = offset - oldOffset;
    return data;
};
svcIpv4.decode.bytes = 0;
svcIpv4.encode = function(data, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(svcIpv4.encodingLength(data));
    if (!offset) offset = 0;
    const oldOffset = offset;
    buf.writeUInt16BE(data.length * 4, offset);
    offset += 2;
    for (let value of data){
        ip.toBuffer(value, buf, offset);
        offset += 4;
    }
    svcIpv4.encode.bytes = offset - oldOffset;
    return buf;
};
svcIpv4.encode.bytes = 0;
svcIpv4.encodingLength = function(data) {
    return 2 + data.length * 4;
};
const svcMandatory = {};
svcMandatory.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const oldOffset = offset;
    var data = [];
    var length = buf.readUInt16BE(offset);
    offset += 2;
    while(length != 0){
        data.push(toString5(buf.readUInt16BE(offset)));
        offset += 2;
        length -= 2;
    }
    svcMandatory.decode.bytes = offset - oldOffset;
    return data;
};
svcMandatory.decode.bytes = 0;
svcMandatory.encode = function(data, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(svcMandatory.encodingLength(data));
    if (!offset) offset = 0;
    const oldOffset = offset;
    buf.writeUInt16BE(data.length * 2, offset);
    offset += 2;
    for (let value of data){
        buf.writeUInt16BE(toKey(value), offset);
        offset += 2;
    }
    svcMandatory.encode.bytes = offset - oldOffset;
    return buf;
};
svcMandatory.encode.bytes = 0;
svcMandatory.encodingLength = function(data) {
    return 2 + data.length * 2;
};
const svcPort = {};
svcPort.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const oldOffset = offset;
    var data = [];
    var length = buf.readUInt16BE(offset);
    offset += 2;
    while(length != 0){
        data.push(buf.readUInt16BE(offset));
        offset += 2;
        length -= 2;
    }
    svcPort.decode.bytes = offset - oldOffset;
    return data;
};
svcPort.decode.bytes = 0;
svcPort.encode = function(data, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(svcPort.encodingLength(data));
    if (!offset) offset = 0;
    const oldOffset = offset;
    buf.writeUInt16BE(data.length * 2, offset);
    offset += 2;
    for (let value of data){
        buf.writeUInt16BE(value, offset);
        offset += 2;
    }
    svcPort.encode.bytes = offset - oldOffset;
    return buf;
};
svcPort.encode.bytes = 0;
svcPort.encodingLength = function(data) {
    return 2 + data.length * 2;
};
const svcEch = {};
svcEch.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const oldOffset = offset;
    var data;
    var length = buf.readUInt16BE(offset);
    offset += 2;
    data = buf.toString("base64", offset, offset + length);
    offset += length;
    svcEch.decode.bytes = offset - oldOffset;
    return data;
};
svcEch.decode.bytes = 0;
svcEch.encode = function(data, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(svcEch.encodingLength(data));
    if (!offset) offset = 0;
    const oldOffset = offset;
    offset += 2;
    offset += buf.write(data, offset, "base64");
    buf.writeUInt16BE(offset - oldOffset - 2, oldOffset);
    svcEch.encode.bytes = offset - oldOffset;
    return buf;
};
svcEch.encode.bytes = 0;
svcEch.encodingLength = function(data) {
    return 2 + Buffer.from(data, "base64").byteLength;
};
const svcOther = {};
svcOther.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const oldOffset = offset;
    var data;
    var length = buf.readUInt16BE(offset);
    offset += 2;
    data = buf.slice(offset, offset + length);
    offset += length;
    svcOther.decode.bytes = offset - oldOffset;
    return data;
};
svcOther.decode.bytes = 0;
svcOther.encode = function(data, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(svcOther.encodingLength(data));
    if (!offset) offset = 0;
    const oldOffset = offset;
    buf.writeUInt16BE(data.byteLength, offset);
    offset += 2;
    offset += data.copy(buf, offset);
    svcOther.encode.bytes = offset - oldOffset;
    return buf;
};
svcOther.encode.bytes = 0;
svcOther.encodingLength = function(data) {
    return 2 + data.byteLength;
};
const svcbKeyObj = function(type) {
    switch(type.toLowerCase()){
        case "mandatory":
            return svcMandatory;
        case "alpn":
            return svcAlpn;
        case "no-default-alpn":
            return svcAlpn;
        case "port":
            return svcPort;
        case "ipv4hint":
            return svcIpv4;
        case "ech":
            return svcEch;
        case "ipv6hint":
            return svcIpv6;
        default:
            return svcOther;
    }
};
const renc = function(type) {
    switch(type.toUpperCase()){
        case "A":
            return ra;
        case "PTR":
            return rptr;
        case "CNAME":
            return rcname;
        case "DNAME":
            return rdname;
        case "TXT":
            return rtxt;
        case "NULL":
            return rnull;
        case "AAAA":
            return raaaa;
        case "SRV":
            return rsrv;
        case "HINFO":
            return rhinfo;
        case "CAA":
            return rcaa;
        case "NS":
            return rns;
        case "SOA":
            return rsoa;
        case "MX":
            return rmx;
        case "OPT":
            return ropt;
        case "DNSKEY":
            return rdnskey;
        case "RRSIG":
            return rrrsig;
        case "RP":
            return rrp;
        case "NSEC":
            return rnsec;
        case "NSEC3":
            return rnsec3;
        case "DS":
            return rds;
        case "HTTPS":
            return rhttpsvcb;
        case "SVCB":
            return rhttpsvcb;
    }
    return runknown;
};
const answer = {};
answer.encode = function(a, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(answer.encodingLength(a));
    if (!offset) offset = 0;
    const oldOffset = offset;
    name.encode(a.name, buf, offset);
    offset += name.encode.bytes;
    buf.writeUInt16BE(toType(a.type), offset);
    if (a.type.toUpperCase() === "OPT") {
        if (a.name !== ".") {
            throw new Error("OPT name must be root.");
        }
        buf.writeUInt16BE(a.udpPayloadSize || 4096, offset + 2);
        buf.writeUInt8(a.extendedRcode || 0, offset + 4);
        buf.writeUInt8(a.ednsVersion || 0, offset + 5);
        buf.writeUInt16BE(a.flags || 0, offset + 6);
        offset += 8;
        ropt.encode(a.options || [], buf, offset);
        offset += ropt.encode.bytes;
    } else {
        let klass = toClass(a.class === undefined ? "IN" : a.class);
        if (a.flush) klass |= FLUSH_MASK;
        buf.writeUInt16BE(klass, offset + 2);
        buf.writeUInt32BE(a.ttl || 0, offset + 4);
        offset += 8;
        const enc = renc(a.type);
        enc.encode(a.data, buf, offset);
        offset += enc.encode.bytes;
    }
    answer.encode.bytes = offset - oldOffset;
    return buf;
};
answer.encode.bytes = 0;
answer.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const a = {};
    const oldOffset = offset;
    a.name = name.decode(buf, offset);
    offset += name.decode.bytes;
    a.type = toString(buf.readUInt16BE(offset));
    if (a.type === "OPT") {
        a.udpPayloadSize = buf.readUInt16BE(offset + 2);
        a.extendedRcode = buf.readUInt8(offset + 4);
        a.ednsVersion = buf.readUInt8(offset + 5);
        a.flags = buf.readUInt16BE(offset + 6);
        a.flag_do = (a.flags >> 15 & 1) === 1;
        a.options = ropt.decode(buf, offset + 8);
        offset += 8 + ropt.decode.bytes;
    } else {
        const klass = buf.readUInt16BE(offset + 2);
        a.ttl = buf.readUInt32BE(offset + 4);
        a.class = toString3(klass & NOT_FLUSH_MASK);
        a.flush = !!(klass & FLUSH_MASK);
        const enc = renc(a.type);
        a.data = enc.decode(buf, offset + 8);
        offset += 8 + enc.decode.bytes;
    }
    answer.decode.bytes = offset - oldOffset;
    return a;
};
answer.decode.bytes = 0;
answer.encodingLength = function(a) {
    const data = a.data !== null && a.data !== undefined ? a.data : a.options;
    return name.encodingLength(a.name) + 8 + renc(a.type).encodingLength(data);
};
const question = {};
question.encode = function(q, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(question.encodingLength(q));
    if (!offset) offset = 0;
    const oldOffset = offset;
    name.encode(q.name, buf, offset);
    offset += name.encode.bytes;
    buf.writeUInt16BE(toType(q.type), offset);
    offset += 2;
    buf.writeUInt16BE(toClass(q.class === undefined ? "IN" : q.class), offset);
    offset += 2;
    question.encode.bytes = offset - oldOffset;
    return q;
};
question.encode.bytes = 0;
question.decode = function(buf, offset) {
    if (!offset) offset = 0;
    const oldOffset = offset;
    const q = {};
    q.name = name.decode(buf, offset);
    offset += name.decode.bytes;
    q.type = toString(buf.readUInt16BE(offset));
    offset += 2;
    q.class = toString3(buf.readUInt16BE(offset));
    offset += 2;
    const qu = !!(q.class & QU_MASK);
    if (qu) q.class &= NOT_QU_MASK;
    question.decode.bytes = offset - oldOffset;
    return q;
};
question.decode.bytes = 0;
question.encodingLength = function(q) {
    return name.encodingLength(q.name) + 4;
};
const encode2 = function(result, buf, offset) {
    if (!buf) buf = Buffer.allocUnsafe(encodingLength(result));
    if (!offset) offset = 0;
    const oldOffset = offset;
    if (!result.questions) result.questions = [];
    if (!result.answers) result.answers = [];
    if (!result.authorities) result.authorities = [];
    if (!result.additionals) result.additionals = [];
    header.encode(result, buf, offset);
    offset += header.encode.bytes;
    offset = encodeList(result.questions, question, buf, offset);
    offset = encodeList(result.answers, answer, buf, offset);
    offset = encodeList(result.authorities, answer, buf, offset);
    offset = encodeList(result.additionals, answer, buf, offset);
    encode2.bytes = offset - oldOffset;
    return buf;
};
encode2.bytes = 0;
const decode2 = function(buf, offset) {
    if (!offset) offset = 0;
    const oldOffset = offset;
    const result = header.decode(buf, offset);
    offset += header.decode.bytes;
    offset = decodeList(result.questions, question, buf, offset);
    offset = decodeList(result.answers, answer, buf, offset);
    offset = decodeList(result.authorities, answer, buf, offset);
    offset = decodeList(result.additionals, answer, buf, offset);
    decode2.bytes = offset - oldOffset;
    return result;
};
decode2.bytes = 0;
const encodingLength = function(result) {
    return header.encodingLength(result) + encodingLengthList(result.questions || [], question) + encodingLengthList(result.answers || [], answer) + encodingLengthList(result.authorities || [], answer) + encodingLengthList(result.additionals || [], answer);
};
const streamEncode = function(result) {
    const buf = encode2(result);
    const sbuf = Buffer.allocUnsafe(2);
    sbuf.writeUInt16BE(buf.byteLength);
    const combine = Buffer.concat([
        sbuf,
        buf
    ]);
    streamEncode.bytes = combine.byteLength;
    return combine;
};
streamEncode.bytes = 0;
const streamDecode = function(sbuf) {
    const len = sbuf.readUInt16BE(0);
    if (sbuf.byteLength < len + 2) {
        return null;
    }
    const result = decode2(sbuf.slice(2));
    streamDecode.bytes = decode2.bytes;
    return result;
};
streamDecode.bytes = 0;
function encodingLengthList(list, enc) {
    let len = 0;
    for(let i22 = 0; i22 < list.length; i22++)len += enc.encodingLength(list[i22]);
    return len;
}
function encodeList(list, enc, buf, offset) {
    for(let i23 = 0; i23 < list.length; i23++){
        enc.encode(list[i23], buf, offset);
        offset += enc.encode.bytes;
    }
    return offset;
}
function decodeList(list, enc, buf, offset) {
    for(let i24 = 0; i24 < list.length; i24++){
        list[i24] = enc.decode(buf, offset);
        offset += enc.decode.bytes;
    }
    return offset;
}
function onDenoDeploy() {
    if (!envManager) return false;
    return envManager.get("CLOUD_PLATFORM") === "deno-deploy";
}
function onCloudflare() {
    if (!envManager) return false;
    return envManager.get("CLOUD_PLATFORM") === "cloudflare";
}
function hasDynamicImports() {
    if (onDenoDeploy() || onCloudflare()) return false;
    return true;
}
function hasHttpCache() {
    return isWorkers();
}
function isWorkers() {
    if (!envManager) return false;
    return envManager.get("RUNTIME") === "worker";
}
function isNode() {
    if (!envManager) return false;
    return envManager.get("RUNTIME") === "node";
}
function isDeno() {
    if (!envManager) return false;
    return envManager.get("RUNTIME") === "deno";
}
function workersTimeout(missing = 0) {
    if (!envManager) return missing;
    return envManager.get("WORKER_TIMEOUT") || missing;
}
function downloadTimeout(missing = 0) {
    if (!envManager) return missing;
    return envManager.get("CF_BLOCKLIST_DOWNLOAD_TIMEOUT") || missing;
}
function blocklistUrl() {
    if (!envManager) return null;
    return envManager.get("CF_BLOCKLIST_URL");
}
function timestamp() {
    if (!envManager) return null;
    return envManager.get("CF_LATEST_BLOCKLIST_TIMESTAMP");
}
function tdNodeCount() {
    if (!envManager) return null;
    return envManager.get("TD_NODE_COUNT");
}
function tdParts() {
    if (!envManager) return null;
    return envManager.get("TD_PARTS");
}
function primaryDohResolver() {
    if (!envManager) return null;
    return envManager.get("CF_DNS_RESOLVER_URL");
}
function secondaryDohResolver() {
    if (!envManager) return null;
    return envManager.get("CF_DNS_RESOLVER_URL_2");
}
function dohResolvers() {
    if (!envManager) return null;
    if (isWorkers()) {
        return [
            primaryDohResolver(),
            secondaryDohResolver()
        ];
    }
    return [
        primaryDohResolver()
    ];
}
function tlsCrtPath() {
    if (!envManager) return "";
    return envManager.get("TLS_CRT_PATH") || "";
}
function tlsKeyPath() {
    if (!envManager) return "";
    return envManager.get("TLS_KEY_PATH") || "";
}
function cacheTtl() {
    if (!envManager) return 0;
    return envManager.get("CACHE_TTL");
}
function isDotOverProxyProto() {
    if (!envManager) return false;
    return envManager.get("DOT_HAS_PROXY_PROTO") || false;
}
function dohBackendPort() {
    return 8080;
}
function dotBackendPort() {
    return isDotOverProxyProto() ? 10001 : 10000;
}
function profileDnsResolves() {
    if (!envManager) return false;
    return envManager.get("PROFILE_DNS_RESOLVES") || false;
}
function forceDoh() {
    if (!envManager) return true;
    if (!isNode()) return true;
    return envManager.get("NODE_DOH_ONLY") || false;
}
function avoidFetch() {
    if (!envManager) return false;
    if (!isNode()) return false;
    return envManager.get("NODE_AVOID_FETCH") || true;
}
function disableDnsCache() {
    return profileDnsResolves();
}
function disableBlocklists() {
    if (!envManager) return false;
    return envManager.get("DISABLE_BLOCKLISTS") || false;
}
const minDNSPacketSize = 12 + 5;
const _dnsCloudflareSec = "1.1.1.2";
function dnsIpv4() {
    return _dnsCloudflareSec;
}
function cacheSize() {
    return 20000;
}
function isAnswer(packet) {
    if (emptyObj(packet)) return false;
    return packet.type === "response";
}
function servfail(qid, qs) {
    if (qid == null || qid < 0 || emptyArray(qs)) return null;
    return encode3({
        id: qid,
        type: "response",
        flags: 4098,
        questions: qs
    });
}
function servfailQ(q) {
    if (emptyBuf(q)) return null;
    try {
        const p = decode3(q);
        return servfail(p.id, p.questions);
    } catch (e) {
        return null;
    }
}
function requestTimeout() {
    const t = workersTimeout();
    return t > 4000 ? Math.min(t, 30000) : 4000;
}
function truncated(ans) {
    if (emptyBuf(ans)) return false;
    if (ans.byteLength < 12) return false;
    const flags = ans.readUInt16BE(2);
    const tc = flags >> 9 & 1;
    return tc === 1;
}
function validResponseSize(r) {
    return r && validateSize(r.byteLength);
}
function validateSize(sz) {
    return sz >= minDNSPacketSize && sz <= 4096;
}
function hasAnswers(packet) {
    return !emptyObj(packet) && !emptyArray(packet.answers);
}
function hasSingleQuestion(packet) {
    return !emptyObj(packet) && !emptyArray(packet.questions) && packet.questions.length === 1;
}
function rcodeNoError(packet) {
    if (emptyObj(packet)) return false;
    return packet.rcode === "NOERROR";
}
function optAnswer(a) {
    if (emptyObj(a) || emptyString(a.type)) return false;
    return a.type.toUpperCase() === "OPT";
}
function decode3(arrayBuffer) {
    if (!validResponseSize(arrayBuffer)) {
        throw new Error("failed decoding an invalid dns-packet");
    }
    const b = bufferOf(arrayBuffer);
    return decode2(b);
}
function encode3(obj) {
    if (emptyObj(obj)) {
        throw new Error("failed encoding an empty dns-obj");
    }
    const b = encode2(obj);
    return arrayBufferOf(b);
}
function isQueryBlockable(packet) {
    return hasSingleQuestion(packet) && (packet.questions[0].type === "A" || packet.questions[0].type === "AAAA" || packet.questions[0].type === "CNAME" || packet.questions[0].type === "HTTPS" || packet.questions[0].type === "SVCB");
}
function isAnswerBlockable(packet) {
    return isCname(packet) || isHttps(packet);
}
function isCname(packet) {
    return hasAnswers(packet) && isAnswerCname(packet.answers[0]);
}
function isAnswerCname(ans) {
    return !emptyObj(ans) && ans.type === "CNAME";
}
function isHttps(packet) {
    return hasAnswers(packet) && isAnswerHttps(packet.answers[0]);
}
function isAnswerHttps(ans) {
    return !emptyObj(ans) && !emptyString(ans.type) && (ans.type === "HTTPS" || ans.type === "SVCB");
}
function extractDomains(dnsPacket) {
    if (!hasSingleQuestion(dnsPacket)) return [];
    const names = new Set();
    const answers = dnsPacket.answers;
    const q = normalizeName(dnsPacket.questions[0].name);
    names.add(q);
    if (emptyArray(answers)) return [
        ...names
    ];
    for (const a of answers){
        if (a && !emptyString(a.name)) {
            const n = normalizeName(a.name);
            names.add(n);
        }
        if (isAnswerCname(a) && !emptyString(a.data)) {
            const n = normalizeName(a.data);
            names.add(n);
        } else if (isAnswerHttps(a) && a.data && !emptyString(a.data.targetName)) {
            const n = normalizeName(a.data.targetName);
            if (n !== ".") names.add(n);
        }
    }
    return [
        ...names
    ];
}
function normalizeName(n) {
    if (emptyString(n)) return n;
    return n.trim().toLowerCase();
}
class CurrentRequest {
    constructor(){
        this.flag = "";
        this.decodedDnsPacket = this.emptyDecodedDnsPacket();
        this.httpResponse = undefined;
        this.isException = false;
        this.exceptionStack = undefined;
        this.exceptionFrom = "";
        this.isDnsBlock = false;
        this.stopProcessing = false;
        this.log = log.withTags("CurrentRequest");
    }
    id(rxid) {
        this.log.tag(rxid);
    }
    emptyDecodedDnsPacket() {
        return {
            id: null,
            questions: null
        };
    }
    initDecodedDnsPacketIfNeeded() {
        if (!this.decodedDnsPacket) {
            this.decodedDnsPacket = this.emptyDecodedDnsPacket();
        }
    }
    dnsExceptionResponse(res) {
        this.initDecodedDnsPacketIfNeeded();
        this.stopProcessing = true;
        this.isException = true;
        if (emptyObj(res)) {
            this.exceptionStack = "no-res";
            this.exceptionFrom = "no-res";
        } else {
            this.exceptionStack = res.exceptionStack || "no-stack";
            this.exceptionFrom = res.exceptionFrom || "no-origin";
        }
        const qid = this.decodedDnsPacket.id;
        const questions = this.decodedDnsPacket.questions;
        const servfail1 = servfail(qid, questions);
        const ex = {
            exceptionFrom: this.exceptionFrom,
            exceptionStack: this.exceptionStack
        };
        this.httpResponse = new Response(servfail1, {
            headers: concatHeaders(this.headers(servfail1), this.additionalHeader(JSON.stringify(ex))),
            status: servfail1 ? 200 : 408
        });
    }
    hResponse(r) {
        if (emptyObj(r)) {
            this.log.w("no http-res to set, empty obj?", r);
            return;
        }
        this.httpResponse = r;
        this.stopProcessing = true;
    }
    dnsResponse(arrayBuffer, dnsPacket = null, blockflag = null) {
        if (emptyBuf(arrayBuffer)) {
            return;
        }
        this.stopProcessing = true;
        this.decodedDnsPacket = dnsPacket || decode3(arrayBuffer);
        this.flag = blockflag || "";
        this.httpResponse = new Response(arrayBuffer, {
            headers: this.headers(arrayBuffer)
        });
    }
    dnsBlockResponse(blockflag) {
        this.initDecodedDnsPacketIfNeeded();
        this.stopProcessing = true;
        this.isDnsBlock = true;
        this.flag = blockflag;
        try {
            if (emptyObj(this.decodedDnsPacket.questions)) {
                throw new Error("decoded dns packet missing");
            }
            this.decodedDnsPacket.type = "response";
            this.decodedDnsPacket.rcode = "NOERROR";
            this.decodedDnsPacket.flags = 384;
            this.decodedDnsPacket.flag_qr = true;
            this.decodedDnsPacket.answers = [];
            this.decodedDnsPacket.answers[0] = {};
            this.decodedDnsPacket.answers[0].name = this.decodedDnsPacket.questions[0].name;
            this.decodedDnsPacket.answers[0].type = this.decodedDnsPacket.questions[0].type;
            this.decodedDnsPacket.answers[0].ttl = 300;
            this.decodedDnsPacket.answers[0].class = "IN";
            this.decodedDnsPacket.answers[0].data = "";
            this.decodedDnsPacket.answers[0].flush = false;
            if (this.decodedDnsPacket.questions[0].type === "A") {
                this.decodedDnsPacket.answers[0].data = "0.0.0.0";
            } else if (this.decodedDnsPacket.questions[0].type === "AAAA") {
                this.decodedDnsPacket.answers[0].data = "::";
            } else if (this.decodedDnsPacket.questions[0].type === "HTTPS" || this.decodedDnsPacket.questions[0].type === "SVCB") {
                this.decodedDnsPacket.answers[0].data = {};
                this.decodedDnsPacket.answers[0].data.svcPriority = 0;
                this.decodedDnsPacket.answers[0].data.targetName = ".";
                this.decodedDnsPacket.answers[0].data.svcParams = {};
            }
            this.decodedDnsPacket.authorities = [];
            const b = encode3(this.decodedDnsPacket);
            this.httpResponse = new Response(b, {
                headers: this.headers(b)
            });
        } catch (e) {
            this.log.e("dnsBlock", JSON.stringify(this.decodedDnsPacket), e.stack);
            this.isException = true;
            this.exceptionStack = e.stack;
            this.exceptionFrom = "CurrentRequest dnsBlockResponse";
            this.httpResponse = new Response(null, {
                headers: concatHeaders(this.headers(), this.additionalHeader(JSON.stringify(this.exceptionStack))),
                status: 503
            });
        }
    }
    headers(b = null) {
        const xNileFlags = this.isDnsBlock ? {
            "x-nile-flags": this.flag
        } : null;
        const xNileFlagsOk = !xNileFlags ? {
            "x-nile-flags-dn": this.flag
        } : null;
        return concatHeaders(dnsHeaders(), contentLengthHeader(b), xNileFlags, xNileFlagsOk);
    }
    additionalHeader(json) {
        if (!json) return null;
        return {
            "x-nile-add": json
        };
    }
    setCorsHeadersIfNeeded() {
        if (emptyObj(this.httpResponse) || !this.httpResponse.ok) return;
        for (const [k, v] of Object.entries(corsHeaders())){
            this.httpResponse.headers.set(k, v);
        }
    }
}
const minlives = 1;
const maxlives = 2 ** 14;
const mincap = 2 ** 5;
const maxcap = 2 ** 32;
const minslots = 2;
class Clock {
    constructor(cap, slotsperhand = 256, maxlife = 16){
        cap = this.bound(cap, mincap, maxcap);
        this.capacity = 2 ** Math.round(Math.log2(cap));
        this.rb = new Array(this.capacity);
        this.rb.fill(null);
        this.store = new Map();
        this.maxcount = this.bound(maxlife, minlives, maxlives);
        this.totalhands = Math.max(minslots, Math.round(this.capacity / slotsperhand));
        this.hands = new Array(this.totalhands);
        for(let i25 = 0; i25 < this.totalhands; i25++)this.hands[i25] = i25;
    }
    next(i26) {
        const n = i26 + this.totalhands;
        return (this.capacity + n) % this.capacity;
    }
    cur(i27) {
        return (this.capacity + i27) % this.capacity;
    }
    prev(i28) {
        const p = i28 - this.totalhands;
        return (this.capacity + p) % this.capacity;
    }
    bound(i29, min, max) {
        i29 = i29 < min ? min : i29;
        i29 = i29 > max ? max - 1 : i29;
        return i29;
    }
    head(n) {
        n = this.bound(n, 0, this.totalhands);
        const h = this.hands[n];
        return this.cur(h);
    }
    incrHead(n) {
        n = this.bound(n, 0, this.totalhands);
        this.hands[n] = this.next(this.hands[n]);
        return this.hands[n];
    }
    decrHead(n) {
        n = this.bound(n, 0, this.totalhands);
        this.hands[n] = this.prev(this.hands[n]);
        return this.hands[n];
    }
    get size() {
        return this.store.size;
    }
    evict(n, c) {
        logd("evict start, head/num/size", this.head(n), n, this.size);
        const start = this.head(n);
        let h = start;
        do {
            const entry = this.rb[h];
            if (entry === null) return true;
            entry.count -= c;
            if (entry.count <= 0) {
                logd("evict", h, entry);
                this.store.delete(entry.key);
                this.rb[h] = null;
                return true;
            }
            h = this.incrHead(n);
        }while (h !== start)
        return false;
    }
    put(k, v, c = 1) {
        const cached = this.store.get(k);
        if (cached) {
            cached.value = v;
            const at = this.rb[cached.pos];
            at.count = Math.min(at.count + c, this.maxcount);
            return true;
        }
        const num = this.rolldice;
        this.evict(num, c);
        const h = this.head(num);
        const hasSlot = this.rb[h] === null;
        if (!hasSlot) return false;
        const ringv = {
            key: k,
            count: Math.min(c, this.maxcount)
        };
        const storev = {
            value: v,
            pos: h
        };
        this.rb[h] = ringv;
        this.store.set(k, storev);
        this.incrHead(num);
        return true;
    }
    val(k, c = 1) {
        const r = this.store.get(k);
        if (!r) return null;
        const at = this.rb[r.pos];
        at.count = Math.min(at.count + c, this.maxcount);
        return r.value;
    }
    get rolldice() {
        const max = this.totalhands;
        return Math.floor(Math.random() * (max - 0)) + 0;
    }
}
function logd() {}
class LfuCache {
    constructor(id, capacity){
        this.id = id;
        this.cache = new Clock(capacity);
    }
    Get(key) {
        let val = false;
        try {
            val = this.cache.val(key) || false;
        } catch (e) {
            console.log("Error: " + this.id + " -> Get");
            console.log(e.stack);
        }
        return val;
    }
    Put(key, val) {
        try {
            this.cache.put(key, val);
        } catch (e) {
            console.log("Error: " + this.id + " -> Put");
            console.log(e.stack);
        }
    }
}
class TrieCache {
    constructor(){
        const name10 = "TrieNodeCache";
        if (true) return;
        const size = Math.floor(tdNodeCount() * 0.2);
        this.localCache = new LfuCache(name10, size);
        this.log = log.withTags(name10);
    }
    get(key) {
        if (true) return false;
        return this.localCache.Get(key);
    }
    put(key, val) {
        if (true) return;
        try {
            this.localCache.Put(key, val);
        } catch (e) {
            this.log.e("put", key, val, e.stack);
        }
    }
}
const BASE64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
const config1 = {
    useBinarySearch: true,
    debug: false,
    selectsearch: true,
    fastPos: true
};
const W = 16;
const bufferView = {
    15: Uint16Array,
    16: Uint16Array,
    6: Uint8Array
};
function chr16(ord) {
    return chrm(ord, false);
}
function chrm(ord, b64) {
    return b64 ? BASE64[ord] : String.fromCharCode(ord);
}
const ORD = {};
for(let i = 0; i < BASE64.length; i++){
    ORD[BASE64[i]] = i;
}
function dec16(chr) {
    return decm(chr, false);
}
function decm(chr, b64) {
    return b64 ? ORD[chr] : chr.charCodeAt(0);
}
const L1 = 32 * 32;
const TxtEnc = new TextEncoder();
const TxtDec = new TextDecoder();
const DELIM = "#";
const ENC_DELIM = TxtEnc.encode(DELIM);
const periodEncVal = TxtEnc.encode(".");
function BitString(str) {
    this.init(str);
}
BitString.MaskTop = {
    16: [
        65535,
        32767,
        16383,
        8191,
        4095,
        2047,
        1023,
        511,
        255,
        127,
        63,
        31,
        15,
        7,
        3,
        1,
        0, 
    ]
};
BitString.MaskBottom = {
    16: [
        65535,
        65534,
        65532,
        65528,
        65520,
        65504,
        65472,
        65408,
        65280,
        65024,
        64512,
        63488,
        61440,
        57344,
        49152,
        32768,
        0, 
    ]
};
const BitsSetTable256 = [];
function initialize() {
    BitsSetTable256[0] = 0;
    for(let i1 = 0; i1 < 256; i1++){
        BitsSetTable256[i1] = (i1 & 1) + BitsSetTable256[Math.floor(i1 / 2)];
    }
}
function countSetBits(n) {
    return BitsSetTable256[n & 255] + BitsSetTable256[n >>> 8 & 255] + BitsSetTable256[n >>> 16 & 255] + BitsSetTable256[n >>> 24];
}
function bit0(n, p, pad) {
    const r = bit0p(n, p);
    if (r.scanned <= 0) return r.scanned;
    if (r.index > 0) return r.scanned;
    if (pad > r.scanned) return r.scanned + 1;
    else return 0;
}
function bit0p(n, p) {
    if (p === 0) return {
        index: 0,
        scanned: 0
    };
    if (n === 0 && p === 1) return {
        index: 1,
        scanned: 1
    };
    let c = 0;
    let i2 = 0;
    const m = n;
    for(c = 0; n > 0 && p > c; n = n >>> 1){
        c = c + (n < (n ^ 1)) ? 1 : 0;
        i2 += 1;
    }
    if (config1.debug) {
        console.log(String.fromCharCode(m).charCodeAt(0).toString(2), m, i2, p, c);
    }
    return {
        index: p === c ? i2 : 0,
        scanned: i2
    };
}
BitString.prototype = {
    init: function(str) {
        this.bytes = str;
        this.length = this.bytes.length * W;
    },
    getData: function() {
        return this.bytes;
    },
    encode: function(n) {
        const e = [];
        for(let i3 = 0; i3 < this.length; i3 += n){
            e.push(this.get(i3, Math.min(this.length, n)));
        }
        return e;
    },
    get: function(p, n, debug = false) {
        if (p % W + n <= W) {
            return (this.bytes[p / W | 0] & BitString.MaskTop[W][p % W]) >> W - p % W - n;
        } else {
            let result = this.bytes[p / W | 0] & BitString.MaskTop[W][p % W];
            let tmpCount = 0;
            const l = W - p % W;
            p += l;
            n -= l;
            while(n >= W){
                tmpCount++;
                result = result << W | this.bytes[p / W | 0];
                p += W;
                n -= W;
            }
            if (n > 0) {
                result = result << n | this.bytes[p / W | 0] >> W - n;
            }
            return result;
        }
    },
    count: function(p, n) {
        let count = 0;
        while(n >= 16){
            count += BitsSetTable256[this.get(p, 16)];
            p += 16;
            n -= 16;
        }
        return count + BitsSetTable256[this.get(p, n)];
    },
    pos0: function(i4, n) {
        if (n < 0) return 0;
        let step = 16;
        let index = i4;
        if (!config1.fastPos) {
            while(n > 0){
                step = n <= 16 ? n : 16;
                const bits0 = step - countSetBits(this.get(i4, step));
                if (config1.debug) {
                    console.log(i4, ":i|step:", step, "get:", this.get(i4, step), "n:", n);
                }
                n -= bits0;
                i4 += step;
                index = i4 - 1;
            }
            return index;
        }
        while(n > 0){
            const d = this.get(i4, step);
            const bits0 = step - countSetBits(d);
            if (config1.debug) {
                console.log(i4, ":i|step:", step, "get:", this.get(i4, step), "n:", n);
            }
            if (n - bits0 < 0) {
                step = Math.max(n, step / 2 | 0);
                continue;
            }
            n -= bits0;
            i4 += step;
            const diff = n === 0 ? bit0(d, 1, step) : 1;
            index = i4 - diff;
        }
        return index;
    },
    rank: function(x) {
        let rank = 0;
        for(let i5 = 0; i5 <= x; i5++){
            if (this.get(i5, 1)) {
                rank++;
            }
        }
        return rank;
    }
};
function RankDirectory(directoryData, bitData, numBits, l1Size, l2Size) {
    this.init(directoryData, bitData, numBits, l1Size, l2Size);
}
RankDirectory.prototype = {
    init: function(directoryData, trieData, numBits, l1Size, l2Size) {
        this.directory = new BitString(directoryData);
        this.data = new BitString(trieData);
        this.l1Size = l1Size;
        this.l2Size = l2Size;
        this.l1Bits = Math.ceil(Math.log2(numBits));
        this.l2Bits = Math.ceil(Math.log2(l1Size));
        this.sectionBits = (l1Size / l2Size - 1) * this.l2Bits + this.l1Bits;
        this.numBits = numBits;
    },
    getData: function() {
        return this.directory.getData();
    },
    rank: function(which, x) {
        if (config1.selectsearch) {
            let rank = -1;
            let sectionPos = 0;
            if (x >= this.l2Size) {
                sectionPos = (x / this.l2Size | 0) * this.l1Bits;
                rank = this.directory.get(sectionPos - this.l1Bits, this.l1Bits);
                x = x % this.l2Size;
            }
            const ans = x > 0 ? this.data.pos0(rank + 1, x) : rank;
            if (config1.debug) {
                console.log("ans:", ans, rank, ":r, x:", x, "s:", sectionPos);
            }
            return ans;
        }
        if (which === 0) {
            return x - this.rank(1, x) + 1;
        }
        let rank = 0;
        let o = x;
        let sectionPos = 0;
        if (o >= this.l1Size) {
            sectionPos = (o / this.l1Size | 0) * this.sectionBits;
            rank = this.directory.get(sectionPos - this.l1Bits, this.l1Bits);
            if (config1.debug) {
                console.log("o: " + rank + " sec: " + sectionPos);
            }
            o = o % this.l1Size;
        }
        if (o >= this.l2Size) {
            sectionPos += (o / this.l2Size | 0) * this.l2Bits;
            rank += this.directory.get(sectionPos - this.l2Bits, this.l2Bits);
            if (config1.debug) {
                console.log("o2: " + rank + " sec: " + sectionPos);
            }
        }
        rank += this.data.count(x - x % this.l2Size, x % this.l2Size + 1);
        if (config1.debug) {
            console.log("ans:", rank, "x:", o, "s:", sectionPos, "o:", x);
        }
        return rank;
    },
    select: function(which, y) {
        let high = this.numBits;
        let low = -1;
        let val = -1;
        if (config1.selectsearch) {
            return this.rank(0, y);
        }
        while(high - low > 1){
            const probe = (high + low) / 2 | 0;
            const r = this.rank(which, probe);
            if (r === y) {
                val = probe;
                high = probe;
            } else if (r < y) {
                low = probe;
            } else {
                high = probe;
            }
        }
        return val;
    }
};
function Tags(flags) {
    this.init();
    this.setupFlags(flags);
}
Tags.prototype = {
    init: function(flags) {
        this.flags = {};
        this.rflags = {};
        this.fsize = 0;
    },
    setupFlags: function(flags) {
        let i6 = 0;
        for (const f of flags){
            this.flags[f] = i6++;
        }
        this.rflags = flags;
        this.fsize = Math.ceil(Math.log2(flags.length) / 16) + 1;
    },
    flagsToTag: function(flags) {
        const header1 = flags[0];
        const tagIndices = [];
        const values = [];
        for(let i8 = 0, mask = 32768; i8 < 16; i8++){
            if (header1 << i8 === 0) break;
            if ((header1 & mask) === mask) {
                tagIndices.push(i8);
            }
            mask = mask >>> 1;
        }
        if (tagIndices.length !== flags.length - 1) {
            console.log(tagIndices, flags, "flags/header mismatch (upsert bug?)");
            return values;
        }
        for(let i7 = 0; i7 < flags.length; i7++){
            const flag = flags[i7 + 1];
            const index = tagIndices[i7];
            for(let j = 0, mask = 32768; j < 16; j++){
                if (flag << j === 0) break;
                if ((flag & mask) === mask) {
                    const pos = index * 16 + j;
                    if (config1.debug) {
                        console.log("pos", pos, "i/ti", index, tagIndices, "j/i", j, i7);
                    }
                    values.push(this.rflags[pos]);
                }
                mask = mask >>> 1;
            }
        }
        return values;
    }
};
function FrozenTrieNode(trie, index) {
    let finCached;
    let whCached;
    let comCached;
    let fcCached;
    let chCached;
    let valCached;
    let flagCached;
    this.trie = trie;
    this.index = index;
    this.final = ()=>{
        if (typeof finCached === "undefined") {
            const extrabits = this.trie.extraBit;
            const bitsize = 1;
            finCached = this.trie.data.get(this.trie.letterStart + index * this.trie.bitslen + extrabits, bitsize) === 1;
        }
        return finCached;
    };
    this.where = ()=>{
        if (typeof whCached === "undefined") {
            const extrabits = 1 + this.trie.extraBit;
            whCached = this.trie.data.get(this.trie.letterStart + index * this.trie.bitslen + extrabits, this.trie.bitslen - extrabits);
        }
        return whCached;
    };
    this.compressed = ()=>{
        const bitsize = 1;
        if (typeof comCached === "undefined") {
            comCached = this.trie.data.get(this.trie.letterStart + index * this.trie.bitslen, bitsize) === 1;
        }
        return comCached;
    };
    this.flag = ()=>{
        if (typeof flagCached === "undefined") {
            flagCached = this.compressed() && this.final();
        }
        return flagCached;
    };
    this.letter = ()=>this.where()
    ;
    this.firstChild = ()=>{
        if (!fcCached) fcCached = this.trie.directory.select(0, index + 1) - index;
        return fcCached;
    };
    this.childOfNextNode = ()=>{
        if (!chCached) {
            chCached = this.trie.directory.select(0, index + 2) - index - 1;
        }
        return chCached;
    };
    this.childCount = ()=>this.childOfNextNode() - this.firstChild()
    ;
    this.value = ()=>{
        if (typeof valCached === "undefined") {
            const value = [];
            let i9 = 0;
            let j = 0;
            if (config1.debug) {
                console.log("cur:i/l/c", this.index, this.letter(), this.childCount());
            }
            while(i9 < this.childCount()){
                const valueChain = this.getChild(i9);
                if (config1.debug) {
                    console.log("vc no-flag end i/l", i9, valueChain.letter());
                    console.log("f/idx/v", valueChain.flag(), valueChain.index, value);
                }
                if (!valueChain.flag()) {
                    break;
                }
                if (i9 % 2 === 0) {
                    value.push(valueChain.letter() << 8);
                } else {
                    value[j] = value[j] | valueChain.letter();
                    j += 1;
                }
                i9 += 1;
            }
            valCached = value;
        }
        return valCached;
    };
    if (config1.debug) {
        console.log(index, ":i, fc:", this.firstChild(), "tl:", this.letter());
        console.log("c:", this.compressed(), "f:", this.final());
        console.log("wh:", this.where(), "flag:", this.flag());
    }
}
FrozenTrieNode.prototype = {
    getChildCount: function() {
        return this.childCount();
    },
    getChild: function(index) {
        return this.trie.getNodeByIndex(this.firstChild() + index);
    }
};
function FrozenTrie(data, rdir, nodeCount) {
    this.init(data, rdir, nodeCount);
}
FrozenTrie.prototype = {
    init: function(trieData, rdir, nodeCount) {
        this.data = new BitString(trieData);
        this.directory = rdir;
        this.extraBit = 1;
        this.bitslen = 9 + this.extraBit;
        this.letterStart = nodeCount * 2 + 1;
        this.nodecache = new TrieCache();
    },
    getNodeByIndex: function(index) {
        let ftnode = this.nodecache.get(index);
        if (emptyObj(ftnode)) {
            ftnode = new FrozenTrieNode(this, index);
            this.nodecache.put(index, ftnode);
        }
        return ftnode;
    },
    getRoot: function() {
        return this.getNodeByIndex(0);
    },
    lookup: function(word) {
        const index = word.lastIndexOf(ENC_DELIM[0]);
        if (index > 0) word = word.slice(0, index);
        const debug = config1.debug;
        let node = this.getRoot();
        let child;
        let returnValue = false;
        for(let i10 = 0; i10 < word.length; i10++){
            let isFlag = -1;
            let that;
            if (periodEncVal[0] === word[i10]) {
                if (node.final()) {
                    if (!returnValue) returnValue = new Map();
                    returnValue.set(TxtDec.decode(word.slice(0, i10).reverse()), node.value());
                }
            }
            do {
                that = node.getChild(isFlag + 1);
                if (!that.flag()) break;
                isFlag += 1;
            }while (isFlag + 1 < node.getChildCount())
            const minChild = isFlag;
            if (debug) {
                console.log("            count: " + node.getChildCount() + " i: " + i10 + " w: " + word[i10] + " nl: " + node.letter() + " flag: " + isFlag);
            }
            if (node.getChildCount() - 1 <= minChild) {
                if (debug) {
                    console.log("  no more children, remaining word: " + word.slice(i10));
                }
                return returnValue;
            }
            if (config1.useBinarySearch === false) {
                let j = isFlag;
                for(; j < node.getChildCount(); j++){
                    child = node.getChild(j);
                    if (debug) {
                        console.log("it:", j, "tl:", child.letter(), "wl:", word[i10]);
                    }
                    if (child.letter() === word[i10]) {
                        if (debug) console.log("it: " + j + " break ");
                        break;
                    }
                }
                if (j === node.getChildCount()) {
                    if (debug) console.log("j: " + j + " c: " + node.getChildCount());
                    return returnValue;
                }
            } else {
                let high = node.getChildCount();
                let low = isFlag;
                while(high - low > 1){
                    const probe = (high + low) / 2 | 0;
                    child = node.getChild(probe);
                    const prevchild = probe > isFlag ? node.getChild(probe - 1) : null;
                    if (debug) {
                        console.log("        current: " + child.letter() + " l: " + low + " h: " + high + " w: " + word[i10]);
                    }
                    if (child.compressed() || prevchild && prevchild.compressed() && !prevchild.flag()) {
                        const startchild = [];
                        const endchild = [];
                        let start = 0;
                        let end = 0;
                        startchild.push(child);
                        start += 1;
                        do {
                            const temp = node.getChild(probe - start);
                            if (!temp.compressed()) break;
                            if (temp.flag()) break;
                            startchild.push(temp);
                            start += 1;
                        }while (true)
                        if (startchild[start - 1].letter() > word[i10]) {
                            if (debug) {
                                console.log("        shrinkh start: " + startchild[start - 1].letter() + " s: " + start + " w: " + word[i10]);
                            }
                            high = probe - start + 1;
                            if (high - low <= 1) {
                                if (debug) {
                                    console.log("...h-low: " + (high - low) + " c: " + node.getChildCount(), high, low, child.letter(), word[i10], probe);
                                }
                                return returnValue;
                            }
                            continue;
                        }
                        if (child.compressed()) {
                            do {
                                end += 1;
                                const temp = node.getChild(probe + end);
                                endchild.push(temp);
                                if (!temp.compressed()) break;
                            }while (true)
                        }
                        if (startchild[start - 1].letter() < word[i10]) {
                            if (debug) {
                                console.log("        shrinkl start: " + startchild[start - 1].letter() + " s: " + start + " w: " + word[i10]);
                            }
                            low = probe + end;
                            if (high - low <= 1) {
                                if (debug) {
                                    console.log("...h-low: " + (high - low) + " c: " + node.getChildCount(), high, low, child.letter(), word[i10], probe);
                                }
                                return returnValue;
                            }
                            continue;
                        }
                        const nodes = startchild.reverse().concat(endchild);
                        const comp = nodes.map((n)=>n.letter()
                        );
                        const w = word.slice(i10, i10 + comp.length);
                        if (debug) {
                            console.log("i", probe, "s", comp, "w", w, "c", child.letter());
                        }
                        if (w.length < comp.length) return returnValue;
                        for(let i11 = 0; i11 < comp.length; i11++){
                            if (w[i11] !== comp[i11]) return returnValue;
                        }
                        if (debug) console.log("it: " + probe + " break ");
                        child = nodes[nodes.length - 1];
                        i10 += comp.length - 1;
                        break;
                    } else {
                        if (child.letter() === word[i10]) {
                            break;
                        } else if (word[i10] > child.letter()) {
                            low = probe;
                        } else {
                            high = probe;
                        }
                    }
                    if (high - low <= 1) {
                        if (debug) {
                            console.log("h-low: " + (high - low) + " c: " + node.getChildCount(), high, low, child.letter(), word[i10], probe);
                        }
                        return returnValue;
                    }
                }
            }
            if (debug) console.log("        next: " + child.letter());
            node = child;
        }
        if (node.final()) {
            if (!returnValue) returnValue = new Map();
            returnValue.set(TxtDec.decode(word.reverse()), node.value());
        }
        return returnValue;
    }
};
function customTagToFlag(fl, blocklistFileTag) {
    let res = chr16(0);
    for (const flag of fl){
        const val = blocklistFileTag[flag].value;
        const header2 = 0;
        const index = val / 16 | 0;
        const pos = val % 16;
        let h = 0;
        h = dec16(res[header2]);
        const dataIndex = countSetBits(h & BitString.MaskBottom[16][16 - index]) + 1;
        let n = (h >>> 15 - index & 1) !== 1 ? 0 : dec16(res[dataIndex]);
        const upsertData = n !== 0;
        h |= 1 << 15 - index;
        n |= 1 << 15 - pos;
        res = chr16(h) + res.slice(1, dataIndex) + chr16(n) + res.slice(upsertData ? dataIndex + 1 : dataIndex);
    }
    return res;
}
function createTrie(tdbuf, rdbuf, blocklistFileTag, blocklistBasicConfig) {
    initialize();
    const tag = {};
    const fl = [];
    for(const fileuname in blocklistFileTag){
        if (!blocklistFileTag.hasOwnProperty(fileuname)) continue;
        fl[blocklistFileTag[fileuname].value] = fileuname;
        const v = DELIM + blocklistFileTag[fileuname].uname;
        tag[fileuname] = v.split("").reverse().join("");
    }
    const tags = new Tags(fl);
    const tdv = new bufferView[16](tdbuf);
    const rdv = new bufferView[16](rdbuf);
    const nc = blocklistBasicConfig.nodecount;
    const numbits = blocklistBasicConfig.nodecount * 2 + 1;
    const rd = new RankDirectory(rdv, tdv, numbits, L1, 32);
    const frozentrie = new FrozenTrie(tdv, rd, nc);
    return {
        t: tags,
        ft: frozentrie
    };
}
const ALPHA32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function readChar(chr) {
    chr = chr.toUpperCase();
    const idx = ALPHA32.indexOf(chr);
    if (idx === -1) {
        throw new Error("invalid b32 character: " + chr);
    }
    return idx;
}
function rbase32(input) {
    input = input.replace(/=+$/, "");
    const length = input.length;
    let bits = 0;
    let value = 0;
    let index = 0;
    const output = new Uint8Array(length * 5 / 8 | 0);
    for(let i30 = 0; i30 < length; i30++){
        value = value << 5 | readChar(input[i30]);
        bits += 5;
        if (bits >= 8) {
            output[index++] = value >>> bits - 8 & 255;
            bits -= 8;
        }
    }
    return output;
}
const _b64delim = ":";
const _b32delim = "+";
const _wildcardUint16 = new Uint16Array([
    64544,
    18431,
    8191,
    65535,
    64640,
    1,
    128,
    16320, 
]);
function isBlocklistFilterSetup(blf) {
    return blf && !emptyObj(blf.t) && !emptyObj(blf.ft);
}
function dnsResponse(packet = null, raw = null, stamps = null) {
    if (emptyObj(packet) || emptyBuf(raw)) {
        throw new Error("empty packet for dns-res");
    }
    return {
        isBlocked: false,
        flag: "",
        dnsPacket: packet,
        dnsBuffer: raw,
        stamps: stamps || {}
    };
}
function copyOnlyBlockProperties(to, from) {
    to.isBlocked = from.isBlocked;
    to.flag = from.flag;
    return to;
}
function rdnsNoBlockResponse(flag = "", packet = null, raw = null, stamps = null) {
    return {
        isBlocked: false,
        flag: flag || "",
        dnsPacket: packet,
        dnsBuffer: raw,
        stamps: stamps || {}
    };
}
function rdnsBlockResponse(flag, packet = null, raw = null, stamps = null) {
    if (emptyString(flag)) {
        throw new Error("no flag set for block-res");
    }
    return {
        isBlocked: true,
        flag: flag,
        dnsPacket: packet,
        dnsBuffer: raw,
        stamps: stamps || {}
    };
}
function doBlock(dn, userBlInfo, dnBlInfo) {
    const noblock = rdnsNoBlockResponse();
    if (emptyString(dn) || emptyObj(dnBlInfo) || emptyObj(userBlInfo)) {
        return noblock;
    }
    const dnUint = new Uint16Array(dnBlInfo[dn]);
    if (emptyArray(dnUint)) return noblock;
    const r = applyBlocklists(userBlInfo.userBlocklistFlagUint, dnUint, userBlInfo.flagVersion);
    if (r.isBlocked) return r;
    if (emptyArray(userBlInfo.userServiceListUint)) return r;
    return applyWildcardBlocklists(userBlInfo.userServiceListUint, userBlInfo.flagVersion, dnBlInfo, dn);
}
function blockstampFromCache(cr) {
    const p = cr.dnsPacket;
    const m = cr.metadata;
    if (emptyObj(p) || emptyObj(m)) return false;
    return m.stamps;
}
function blockstampFromBlocklistFilter(dnsPacket, blocklistFilter) {
    if (emptyObj(dnsPacket)) return false;
    if (!isBlocklistFilterSetup(blocklistFilter)) return false;
    const domains = extractDomains(dnsPacket);
    if (emptyArray(domains)) return false;
    const m = new Map();
    for (const n of domains){
        const stamp = blocklistFilter.blockstamp(n);
        if (emptyMap(stamp)) continue;
        for (const [k, v] of stamp)m.set(k, v);
    }
    return emptyMap(m) ? false : objOf(m);
}
function applyWildcardBlocklists(uint1, flagVersion, dnBlInfo, dn) {
    const dnSplit = dn.split(".");
    while(dnSplit.shift() !== undefined){
        const subdomain = dnSplit.join(".");
        const subdomainUint = dnBlInfo[subdomain];
        if (emptyArray(subdomainUint)) continue;
        const response = applyBlocklists(uint1, subdomainUint, flagVersion);
        if (!emptyObj(response) && response.isBlocked) {
            return response;
        }
    }
    return rdnsNoBlockResponse();
}
function applyBlocklists(uint1, uint2, flagVersion) {
    const blockedUint = intersect(uint1, uint2);
    if (blockedUint) {
        return rdnsBlockResponse(getB64Flag(blockedUint, flagVersion));
    } else {
        return rdnsNoBlockResponse(getB64Flag(uint2, flagVersion));
    }
}
function intersect(flag1, flag2) {
    if (emptyArray(flag1) || emptyArray(flag2)) return null;
    let header1 = flag1[0];
    let header2 = flag2[0];
    let commonHeader = header1 & header2;
    if (commonHeader === 0) {
        return null;
    }
    let i31 = flag1.length - 1;
    let j = flag2.length - 1;
    let h = commonHeader;
    let pos = 0;
    const commonBody = [];
    while(h !== 0){
        if (i31 < 0 || j < 0) throw new Error("blockstamp header/body mismatch");
        if ((h & 1) === 1) {
            const commonFlags = flag1[i31] & flag2[j];
            if (commonFlags === 0) {
                commonHeader = clearbit(commonHeader, pos);
            } else {
                commonBody.push(commonFlags);
            }
        }
        if ((header1 & 1) === 1) {
            i31 -= 1;
        }
        if ((header2 & 1) === 1) {
            j -= 1;
        }
        header1 >>>= 1;
        header2 >>>= 1;
        h >>>= 1;
        pos += 1;
    }
    if (commonHeader === 0) {
        return null;
    }
    return Uint16Array.of(commonHeader, ...commonBody.reverse());
}
function clearbit(uint, pos) {
    return uint & ~(1 << pos);
}
function getB64Flag(uint16Arr, flagVersion) {
    if (emptyArray(uint16Arr)) return "";
    const b64url = bytesToBase64Url(uint16Arr.buffer);
    if (flagVersion === "0") {
        return encodeURIComponent(b64url);
    } else if (flagVersion === "1") {
        const flag = encodeURI(b64url);
        return flagVersion + ":" + flag;
    } else {
        throw new Error("unsupported flag version" + flagVersion);
    }
}
function blockstampFromUrl(u) {
    const url = new URL(u);
    const paths = url.pathname.split("/");
    if (paths.length <= 1) {
        return "";
    }
    if (paths[1].toLowerCase() === "dns-query") {
        return paths[2] || "";
    } else {
        return paths[1] || "";
    }
}
function base64ToUintV0(b64Flag) {
    const f = decodeURIComponent(b64Flag);
    return base64ToUint16(f);
}
function base64ToUintV1(b64Flag) {
    return base64ToUint16(b64Flag);
}
function base32ToUintV1(flag) {
    const b32 = decodeURI(flag);
    return decodeFromBinaryArray(rbase32(b32));
}
function isB32Stamp(s) {
    return s.indexOf(_b32delim) > 0;
}
function stampVersion(s) {
    if (!emptyArray(s)) return s[0];
    else return "0";
}
function unstamp(flag) {
    const r = {
        userBlocklistFlagUint: null,
        flagVersion: "0",
        userServiceListUint: null
    };
    if (emptyString(flag)) return r;
    flag = flag.trim();
    const isFlagB32 = isB32Stamp(flag);
    const s = flag.split(isFlagB32 ? _b32delim : _b64delim);
    let convertor = (x)=>""
    ;
    let f = "";
    const v = stampVersion(s);
    if (v === "0") {
        convertor = base64ToUintV0;
        f = s[0];
    } else if (v === "1") {
        convertor = isFlagB32 ? base32ToUintV1 : base64ToUintV1;
        f = s[1];
    } else {
        log.w("Rdns:unstamp", "unknown blocklist stamp version in " + s);
        return r;
    }
    r.flagVersion = v;
    r.userBlocklistFlagUint = convertor(f) || null;
    r.userServiceListUint = intersect(r.userBlocklistFlagUint, _wildcardUint16);
    return r;
}
function hasBlockstamp(blockInfo) {
    return !emptyObj(blockInfo) && !emptyArray(blockInfo.userBlocklistFlagUint);
}
class BlocklistFilter {
    constructor(){
        this.t = null;
        this.ft = null;
        this.blocklistBasicConfig = null;
        this.blocklistFileTag = null;
        this.enc = new TextEncoder();
    }
    load(t, ft, blocklistBasicConfig, blocklistFileTag) {
        this.t = t;
        this.ft = ft;
        this.blocklistBasicConfig = blocklistBasicConfig;
        this.blocklistFileTag = blocklistFileTag;
    }
    blockstamp(domainName) {
        const n = normalizeName(domainName);
        return this.lookup(n);
    }
    lookup(n) {
        return this.ft.lookup(this.reverseUtf8(n));
    }
    reverseUtf8(s) {
        return this.enc.encode(s).reverse();
    }
    getTag(uintFlag) {
        return this.t.flagsToTag(uintFlag);
    }
    getB64FlagFromTag(tagList, flagVersion) {
        const uintFlag = customTagToFlag(tagList, this.blocklistFileTag);
        return getB64Flag(uintFlag, flagVersion);
    }
}
class BlocklistWrapper {
    constructor(){
        this.blocklistFilter = new BlocklistFilter();
        this.td = null;
        this.rd = null;
        this.ft = null;
        this.startTime = Date.now();
        this.isBlocklistUnderConstruction = false;
        this.exceptionFrom = "";
        this.exceptionStack = "";
        this.noop = disableBlocklists();
        this.log = log.withTags("BlocklistWrapper");
        if (this.noop) this.log.w("disabled?", this.noop);
    }
    async init(rxid) {
        if (this.isBlocklistFilterSetup() || this.disabled()) {
            const blres = emptyResponse();
            blres.data.blocklistFilter = this.blocklistFilter;
            return blres;
        }
        try {
            const now = Date.now();
            if (!this.isBlocklistUnderConstruction || now - this.startTime > downloadTimeout() * 2) {
                this.log.i(rxid, "download blocklists", now, this.startTime);
                return this.initBlocklistConstruction(rxid, now, blocklistUrl(), timestamp(), tdNodeCount(), tdParts());
            } else {
                return this.waitUntilDone();
            }
        } catch (e) {
            this.log.e(rxid, "main", e.stack);
            return errResponse("blocklistWrapper", e);
        }
    }
    disabled() {
        return this.noop;
    }
    getBlocklistFilter() {
        return this.blocklistFilter;
    }
    isBlocklistFilterSetup() {
        return isBlocklistFilterSetup(this.blocklistFilter);
    }
    async waitUntilDone() {
        let totalWaitms = 0;
        const waitms = 25;
        const response = emptyResponse();
        while(totalWaitms < downloadTimeout()){
            if (this.isBlocklistFilterSetup()) {
                response.data.blocklistFilter = this.blocklistFilter;
                return response;
            }
            await sleep(25);
            totalWaitms += waitms;
        }
        response.isException = true;
        response.exceptionStack = this.exceptionStack || "download timeout";
        response.exceptionFrom = this.exceptionFrom || "blocklistWrapper.js";
        return response;
    }
    initBlocklistFilterConstruction(td, rd, ftags, bconfig) {
        this.isBlocklistUnderConstruction = true;
        this.startTime = Date.now();
        const filter = createTrie(td, rd, ftags, bconfig);
        this.blocklistFilter.load(filter.t, filter.ft, bconfig, ftags);
        this.isBlocklistUnderConstruction = false;
    }
    async initBlocklistConstruction(rxid, when1, blocklistUrl1, latestTimestamp, tdNodecount, tdParts1) {
        this.isBlocklistUnderConstruction = true;
        this.startTime = when1;
        let response = emptyResponse();
        try {
            const bl = await this.downloadBuildBlocklist(rxid, blocklistUrl1, latestTimestamp, tdNodecount, tdParts1);
            this.blocklistFilter.load(bl.t, bl.ft, bl.blocklistBasicConfig, bl.blocklistFileTag);
            this.log.i(rxid, "blocklist-filter setup");
            response.data.blocklistFilter = this.blocklistFilter;
        } catch (e) {
            this.log.e(rxid, "initBlocklistConstruction", e.stack);
            response = errResponse("initBlocklistConstruction", e);
            this.exceptionFrom = response.exceptionFrom;
            this.exceptionStack = response.exceptionStack;
        }
        this.isBlocklistUnderConstruction = false;
        return response;
    }
    async downloadBuildBlocklist(rxid, blocklistUrl2, latestTimestamp, tdNodecount, tdParts2) {
        !tdNodecount && this.log.e(rxid, "tdNodecount zero or missing!");
        const resp = {};
        const baseurl = blocklistUrl2 + latestTimestamp;
        const blocklistBasicConfig = {
            nodecount: tdNodecount || -1,
            tdparts: tdParts2 || -1
        };
        this.log.d(rxid, blocklistUrl2, latestTimestamp, tdNodecount, tdParts2);
        const buf0 = fileFetch(baseurl + "/filetag.json", "json");
        const buf1 = makeTd(baseurl, blocklistBasicConfig.tdparts);
        const buf2 = fileFetch(baseurl + "/rd.txt", "buffer");
        const downloads = await Promise.all([
            buf0,
            buf1,
            buf2
        ]);
        this.log.i(rxid, "create trie", blocklistBasicConfig);
        this.td = downloads[1];
        this.rd = downloads[2];
        this.ft = downloads[0];
        const trie = createTrie(this.td, this.rd, this.ft, blocklistBasicConfig);
        resp.t = trie.t;
        resp.ft = trie.ft;
        resp.blocklistBasicConfig = blocklistBasicConfig;
        resp.blocklistFileTag = this.ft;
        return resp;
    }
}
async function fileFetch(url, typ) {
    if (typ !== "buffer" && typ !== "json") {
        log.i("fetch fail", typ, url);
        throw new Error("Unknown conversion type at fileFetch");
    }
    log.i("downloading", url, typ);
    const res = await fetch(url, {
        cf: {
            cacheTtl: 1209600
        }
    });
    if (!res.ok) {
        log.e("file-fetch err", url, res);
        throw new Error(JSON.stringify([
            url,
            res,
            "fileFetch fail"
        ]));
    }
    if (typ === "buffer") {
        return await res.arrayBuffer();
    } else if (typ === "json") {
        return await res.json();
    }
}
async function makeTd(baseurl, n) {
    log.i("makeTd from tdParts", n);
    if (n <= -1) {
        return fileFetch(baseurl + "/td.txt", "buffer");
    }
    const tdpromises = [];
    for(let i32 = 0; i32 <= n; i32++){
        const f = baseurl + "/td" + i32.toLocaleString("en-US", {
            minimumIntegerDigits: 2,
            useGrouping: false
        }) + ".txt";
        tdpromises.push(fileFetch(f, "buffer"));
    }
    const tds = await Promise.all(tdpromises);
    log.i("tds downloaded");
    return concat(tds);
}
class CommandControl {
    constructor(blocklistWrapper){
        this.latestTimestamp = timestamp();
        this.log = log.withTags("CommandControl");
        this.bw = blocklistWrapper;
    }
    async RethinkModule(param) {
        if (isGetRequest(param.request)) {
            return await this.commandOperation(param.rxid, param.request.url, param.isDnsMsg);
        }
        return emptyResponse();
    }
    isConfigureCmd(s) {
        return s === "configure" || s === "config";
    }
    isDohGetRequest(queryString) {
        return queryString && queryString.has("dns");
    }
    userFlag(url, isDnsCmd = false) {
        const emptyFlag = "";
        const p = url.pathname.split("/");
        const d = url.host.split(".");
        if (this.isConfigureCmd(p[1])) {
            return p.length >= 3 ? p[2] : emptyFlag;
        }
        if (isDnsCmd) return emptyFlag;
        if (p[1]) return p[1];
        return d.length > 1 ? d[0] : emptyFlag;
    }
    async commandOperation(rxid, url, isDnsMsg1) {
        let response = emptyResponse();
        try {
            const reqUrl = new URL(url);
            const queryString = reqUrl.searchParams;
            const pathSplit = reqUrl.pathname.split("/");
            const isDnsCmd = isDnsMsg1 || this.isDohGetRequest(queryString);
            if (isDnsCmd) {
                response.data.stopProcessing = false;
                return response;
            } else {
                response.data.stopProcessing = true;
            }
            const command = pathSplit[1];
            const b64UserFlag = this.userFlag(reqUrl, isDnsCmd);
            this.log.d(rxid, "processing...", url, command, b64UserFlag);
            await this.bw.init(rxid);
            const blf = this.bw.getBlocklistFilter();
            const isBlfSetup = isBlocklistFilterSetup(blf);
            if (!isBlfSetup) throw new Error("no blocklist-filter");
            if (command === "listtob64") {
                response.data.httpResponse = listToB64(queryString, blf);
            } else if (command === "b64tolist") {
                response.data.httpResponse = b64ToList(queryString, blf);
            } else if (command === "dntolist") {
                response.data.httpResponse = domainNameToList(queryString, blf, this.latestTimestamp);
            } else if (command === "dntouint") {
                response.data.httpResponse = domainNameToUint(queryString, blf);
            } else if (command === "config" || command === "configure" || !isDnsCmd) {
                response.data.httpResponse = configRedirect(b64UserFlag, reqUrl.origin, this.latestTimestamp, !isDnsCmd);
            } else {
                this.log.w(rxid, "unknown command-control query");
                response.data.httpResponse = respond400();
            }
        } catch (e) {
            this.log.e(rxid, "err cc:op", e.stack);
            response = errResponse("cc:op", e);
            response.data.httpResponse = jsonResponse(e.stack);
        }
        return response;
    }
}
function isRethinkDns(hostname) {
    return hostname.indexOf("rethinkdns") >= 0;
}
function configRedirect(userFlag, origin, timestamp1, highlight) {
    const u = "https://rethinkdns.com/configure";
    let q = "?tstamp=" + timestamp1;
    q += !isRethinkDns(origin) ? "&v=ext&u=" + origin : "";
    q += highlight ? "&s=added" : "";
    q += userFlag ? "#" + userFlag : "";
    return Response.redirect(u + q, 302);
}
function domainNameToList(queryString, blocklistFilter, latestTimestamp) {
    const domainName = queryString.get("dn") || "";
    const r = {
        domainName: domainName,
        version: latestTimestamp,
        list: {},
        listDetail: {}
    };
    const searchResult = blocklistFilter.lookup(domainName);
    if (!searchResult) {
        return jsonResponse(r);
    }
    for (const entry of searchResult){
        const list = blocklistFilter.getTag(entry[1]);
        const listDetail = {};
        for (const listValue of list){
            listDetail[listValue] = blocklistFilter.blocklistFileTag[listValue];
        }
        r.list[entry[0]] = listDetail;
    }
    return jsonResponse(r);
}
function domainNameToUint(queryString, blocklistFilter) {
    const domainName = queryString.get("dn") || "";
    const r = {
        domainName: domainName,
        list: {}
    };
    const searchResult = blocklistFilter.lookup(domainName);
    if (!searchResult) {
        return jsonResponse(r);
    }
    for (const entry of searchResult){
        r.list[entry[0]] = entry[1];
    }
    return jsonResponse(r);
}
function listToB64(queryString, blocklistFilter) {
    const list = queryString.get("list") || [];
    const flagVersion = queryString.get("flagversion") || "0";
    const tags = list.split(",");
    const r = {
        command: "List To B64String",
        inputList: list,
        flagVersion: flagVersion,
        b64String: blocklistFilter.getB64FlagFromTag(tags, flagVersion)
    };
    return jsonResponse(r);
}
function b64ToList(queryString, blocklistFilter) {
    const b64 = queryString.get("b64") || "";
    const r = {
        command: "Base64 To List",
        inputB64: b64,
        list: [],
        listDetail: {}
    };
    const stamp = unstamp(b64);
    if (!hasBlockstamp(stamp)) {
        return jsonResponse(r);
    }
    r.list = blocklistFilter.getTag(stamp.userBlocklistFlagUint);
    for (const listValue of r.list){
        r.listDetail[listValue] = blocklistFilter.blocklistFileTag[listValue];
    }
    return jsonResponse(r);
}
function jsonResponse(obj) {
    return new Response(JSON.stringify(obj), {
        headers: jsonHeaders()
    });
}
class UserCache {
    constructor(size){
        const name11 = "UserCache";
        this.localCache = new LfuCache(name11, size);
        this.log = log.withTags(name11);
    }
    get(key) {
        return this.localCache.Get(key);
    }
    put(key, val) {
        try {
            this.localCache.Put(key, val);
        } catch (e) {
            this.log.e("put", key, val, e.stack);
        }
    }
}
const cacheSize1 = 10000;
class UserOperation {
    constructor(){
        this.userConfigCache = new UserCache(cacheSize1);
        this.log = log.withTags("UserOp");
    }
    async RethinkModule(param) {
        return this.loadUser(param);
    }
    loadUser(param) {
        let response = emptyResponse();
        if (!param.isDnsMsg) {
            this.log.w(param.rxid, "not a dns-msg, ignore");
            return response;
        }
        try {
            const blocklistFlag = blockstampFromUrl(param.request.url);
            let r = this.userConfigCache.get(blocklistFlag);
            if (emptyObj(r)) {
                r = unstamp(blocklistFlag);
                this.log.d(param.rxid, "new cfg cache kv", blocklistFlag, r);
                this.userConfigCache.put(blocklistFlag, r);
            }
            response.data.userBlocklistInfo = r;
            response.data.dnsResolverUrl = null;
        } catch (e) {
            this.log.e(param.rxid, "loadUser", e);
            response = errResponse("UserOp:loadUser", e);
        }
        return response;
    }
}
class DnsBlocker {
    constructor(){
        this.log = log.withTags("DnsBlocker");
    }
    blockQuestion(rxid, req, blockInfo) {
        const dnsPacket = req.dnsPacket;
        const stamps = req.stamps;
        if (!stamps) {
            this.log.d(rxid, "q: no stamp");
            return req;
        }
        if (!hasBlockstamp(blockInfo)) {
            this.log.d(rxid, "q: no user-set blockstamp");
            return req;
        }
        if (!isQueryBlockable(dnsPacket)) {
            this.log.d(rxid, "not a blockable dns-query");
            return req;
        }
        const domains = extractDomains(dnsPacket);
        const bres = this.block(domains, blockInfo, stamps);
        return copyOnlyBlockProperties(req, bres);
    }
    blockAnswer(rxid, res, blockInfo) {
        const dnsPacket = res.dnsPacket;
        const stamps = res.stamps;
        if (!stamps || !hasAnswers(dnsPacket)) {
            this.log.d(rxid, "ans: no stamp / dns-packet");
            return res;
        }
        if (!hasBlockstamp(blockInfo)) {
            this.log.d(rxid, "ans: no user-set blockstamp");
            return res;
        }
        if (!isAnswerBlockable(dnsPacket)) {
            this.log.d(rxid, "ans not cloaked with cname/https/svcb");
            return res;
        }
        const domains = extractDomains(dnsPacket);
        const bres = this.block(domains, blockInfo, stamps);
        return copyOnlyBlockProperties(res, bres);
    }
    block(names, blockInfo, blockstamps) {
        let r = rdnsNoBlockResponse();
        for (const n of names){
            r = doBlock(n, blockInfo, blockstamps);
            if (r.isBlocked) break;
        }
        return r;
    }
}
const minTtlSec = 30;
const cheader = "x-rdnscache-metadata";
const _cacheurl = "https://caches.rethinkdns.com/";
const _cacheHeaderKey = "x-rdns-cache";
const _cacheHeaderHitValue = "hit";
const _cacheHeaders = {
    [_cacheHeaderKey]: _cacheHeaderHitValue
};
function determineCacheExpiry(packet) {
    const someVeryHighTtl = 1 << 30;
    if (!isAnswer(packet)) return 0;
    let ttl = someVeryHighTtl;
    for (const a of packet.answers)ttl = Math.min(a.ttl || minTtlSec, ttl);
    if (ttl === someVeryHighTtl) ttl = minTtlSec;
    ttl += cacheTtl();
    const expiry = Date.now() + ttl * 1000;
    return expiry;
}
function makeCacheMetadata(dnsPacket, stamps) {
    return {
        expiry: determineCacheExpiry(dnsPacket),
        stamps: stamps
    };
}
function makeCacheValue(packet, raw, metadata) {
    return {
        dnsPacket: packet,
        dnsBuffer: raw,
        metadata: metadata
    };
}
function cacheValueOf(rdnsResponse) {
    const stamps = rdnsResponse.stamps;
    const packet = rdnsResponse.dnsPacket;
    const raw = rdnsResponse.dnsBuffer;
    const metadata = makeCacheMetadata(packet, stamps);
    return makeCacheValue(packet, raw, metadata);
}
function updateTtl(packet, end) {
    const now = Date.now();
    const actualttl = Math.floor((end - now) / 1000) - cacheTtl();
    const outttl = actualttl < 30 ? rand(30, 180) : actualttl;
    for (const a of packet.answers){
        if (!optAnswer(a)) a.ttl = outttl;
    }
}
function makeId(packet) {
    if (!hasSingleQuestion(packet)) return null;
    const name12 = normalizeName(packet.questions[0].name);
    const type = packet.questions[0].type;
    return name12 + ":" + type;
}
function makeLocalCacheValue(b, metadata) {
    return {
        dnsBuffer: b,
        metadata: metadata
    };
}
function makeHttpCacheValue(b, metadata) {
    const headers = {
        headers: concatHeaders({
            [cheader]: embedMetadata(metadata),
            "Cache-Control": "max-age=604800"
        }, contentLengthHeader(b))
    };
    return new Response(b, headers);
}
function makeHttpCacheKey(packet) {
    const id = makeId(packet);
    if (emptyString(id)) return null;
    return new URL(_cacheurl + timestamp() + "/" + id);
}
function extractMetadata(cres) {
    return JSON.parse(cres.headers.get(cheader));
}
function embedMetadata(m) {
    return JSON.stringify(m);
}
function cacheHeaders() {
    return _cacheHeaders;
}
function hasCacheHeader(h) {
    if (!h) return false;
    return h.get(_cacheHeaderKey) === _cacheHeaderHitValue;
}
function updateQueryId(decodedDnsPacket, queryId) {
    if (queryId === decodedDnsPacket.id) return false;
    decodedDnsPacket.id = queryId;
    return true;
}
function isValueValid(v) {
    if (emptyObj(v)) return false;
    return hasMetadata(v.metadata);
}
function hasMetadata(m) {
    return !emptyObj(m);
}
function isAnswerFresh(m, n = 0) {
    const now = Date.now();
    const ttl = cacheTtl() * 1000;
    const r = n || rolldice(6);
    if (r % 6 === 0) {
        return m.expiry > 0 && now <= m.expiry - ttl;
    } else {
        return m.expiry > 0 && now <= m.expiry;
    }
}
function updatedAnswer(dnsPacket, qid, expiry) {
    updateQueryId(dnsPacket, qid);
    updateTtl(dnsPacket, expiry);
    return dnsPacket;
}
class DNSResolver {
    constructor(blocklistWrapper, cache){
        this.cache = cache;
        this.http2 = null;
        this.nodeutil = null;
        this.transport = null;
        this.blocker = new DnsBlocker();
        this.bw = blocklistWrapper;
        this.log = log.withTags("DnsResolver");
        this.measurements = [];
        this.profileResolve = profileDnsResolves();
        this.forceDoh = forceDoh();
        this.avoidFetch = avoidFetch();
        if (this.profileResolve) {
            this.log.w("profiling", this.determineDohResolvers());
            this.log.w("doh?", this.forceDoh, "fetch?", this.avoidFetch);
        }
    }
    async lazyInit() {
        if (!hasDynamicImports()) return;
        if (isNode() && !this.http2) {
            this.http2 = await import("http2");
            this.log.i("created custom http2 client");
        }
        if (isNode() && !this.nodeutil) {
            this.nodeutil = await import("../../core/node/util.js");
            this.log.i("imported node-util");
        }
        if (isNode() && !this.transport) {
            const plainOldDnsIp = dnsIpv4();
            this.transport = new (await import("../../core/node/dns-transport.js")).Transport(plainOldDnsIp, 53);
            this.log.i("created udp/tcp dns transport", plainOldDnsIp);
        }
    }
    async RethinkModule(param) {
        await this.lazyInit();
        let response = emptyResponse();
        try {
            response.data = await this.resolveDns(param);
        } catch (e) {
            response = errResponse("dnsResolver", e);
            this.log.e(param.rxid, "main", e.stack);
        }
        return response;
    }
    determineDohResolvers(preferredByUser) {
        if (this.transport && !this.forceDoh) return [];
        if (!emptyString(preferredByUser)) {
            return [
                preferredByUser
            ];
        }
        if (!this.bw.disabled() && !this.bw.isBlocklistFilterSetup()) {
            return [
                primaryDohResolver()
            ];
        }
        return dohResolvers();
    }
    logMeasurementsPeriodically(period = 100) {
        const len = this.measurements.length - 1;
        if ((len + 1) % period !== 0) return;
        this.measurements.sort((a, b)=>a - b
        );
        const p10 = this.measurements[Math.floor(len * 0.1)];
        const p50 = this.measurements[Math.floor(len * 0.5)];
        const p75 = this.measurements[Math.floor(len * 0.75)];
        const p90 = this.measurements[Math.floor(len * 0.9)];
        const p95 = this.measurements[Math.floor(len * 0.95)];
        const p99 = this.measurements[Math.floor(len * 0.99)];
        const p999 = this.measurements[Math.floor(len * 0.999)];
        const p9999 = this.measurements[Math.floor(len * 0.9999)];
        const p100 = this.measurements[len];
        this.log.qStart("runs:", len + 1);
        this.log.q("p10/50/75/90/95", p10, p50, p75, p90, p95);
        this.log.qEnd("p99/99.9/99.99/100", p99, p999, p9999, p100);
    }
    async resolveDns(param) {
        const rxid = param.rxid;
        const blInfo = param.userBlocklistInfo;
        const rawpacket = param.requestBodyBuffer;
        const decodedpacket = param.requestDecodedDnsPacket;
        const userDns = param.userDnsResolverUrl;
        const dispatcher = param.dispatcher;
        const stamps = param.domainBlockstamp;
        let blf = this.bw.getBlocklistFilter();
        const isBlfDisabled = this.bw.disabled();
        let isBlfSetup = isBlocklistFilterSetup(blf);
        const q = await this.makeRdnsResponse(rxid, rawpacket, blf, stamps);
        this.blocker.blockQuestion(rxid, q, blInfo);
        this.log.d(rxid, "q block?", q.isBlocked, "blf?", isBlfSetup);
        if (q.isBlocked) {
            this.primeCache(rxid, q, dispatcher);
            return q;
        }
        let resolveStart = 0;
        let resolveEnd = 0;
        if (this.profileResolve) {
            resolveStart = Date.now();
        }
        const promisedTasks = await Promise.all([
            this.bw.init(rxid),
            this.resolveDnsUpstream(rxid, param.request, this.determineDohResolvers(userDns), rawpacket, decodedpacket), 
        ]);
        if (this.profileResolve) {
            resolveEnd = Date.now();
            this.measurements.push(resolveEnd - resolveStart);
            this.logMeasurementsPeriodically();
        }
        const res = promisedTasks[1];
        if (!isBlfDisabled && !isBlfSetup) {
            this.log.d(rxid, "blocklist-filter downloaded and setup");
            blf = this.bw.getBlocklistFilter();
            isBlfSetup = isBlocklistFilterSetup(blf);
        } else {
            isBlfSetup = true;
        }
        if (!isBlfSetup) throw new Error(rxid + " no blocklist-filter");
        if (!res) throw new Error(rxid + " no upstream result");
        if (!res.ok) {
            const txt = res.text && await res.text();
            this.log.d(rxid, "!OK", res, txt);
            throw new Error(txt + " http err: " + res);
        }
        const ans = await res.arrayBuffer();
        const r = await this.makeRdnsResponse(rxid, ans, blf, stamps);
        this.blocker.blockAnswer(rxid, r, blInfo);
        const fromCache = hasCacheHeader(res.headers);
        this.log.d(rxid, "ans block?", r.isBlocked, "from cache?", fromCache);
        if (!fromCache) {
            this.primeCache(rxid, r, dispatcher);
        }
        return r;
    }
    async makeRdnsResponse(rxid, raw, blf, stamps = null) {
        if (!raw) throw new Error(rxid + " mk-res no upstream result");
        const dnsPacket = decode3(raw);
        stamps = emptyObj(stamps) ? blockstampFromBlocklistFilter(dnsPacket, blf) : stamps;
        return dnsResponse(dnsPacket, raw, stamps);
    }
    primeCache(rxid, r, dispatcher) {
        const blocked = r.isBlocked;
        const k = makeHttpCacheKey(r.dnsPacket);
        this.log.d(rxid, "primeCache: block?", blocked, "k", k.href);
        if (!k) {
            this.log.d(rxid, "no cache-key, url/query missing?", k, r.stamps);
            return;
        }
        const v = cacheValueOf(r);
        this.cache.put(k, v, dispatcher);
    }
}
DNSResolver.prototype.resolveDnsUpstream = async function(rxid, request, resolverUrls, query, packet) {
    const promisedPromises = [];
    if (emptyArray(resolverUrls)) {
        try {
            const q = bufferOf(query);
            let ans = await this.transport.udpquery(rxid, q);
            if (truncated(ans)) {
                this.log.w(rxid, "ans truncated, retrying over tcp");
                ans = await this.transport.tcpquery(rxid, q);
            }
            if (ans) {
                const r = new Response(arrayBufferOf(ans));
                promisedPromises.push(Promise.resolve(r));
            } else {
                promisedPromises.push(Promise.resolve(respond503()));
            }
        } catch (e) {
            this.log.e(rxid, "err when querying plain old dns", e.stack);
            promisedPromises.push(Promise.reject(e));
        }
        return Promise.any(promisedPromises);
    }
    try {
        this.log.d(rxid, "upstream cache");
        promisedPromises.push(this.resolveDnsFromCache(rxid, packet));
        for (const rurl of resolverUrls){
            if (emptyString(rurl)) {
                this.log.w(rxid, "missing resolver url", rurl);
                continue;
            }
            const u = new URL(request.url);
            const upstream = new URL(rurl);
            u.hostname = upstream.hostname;
            u.pathname = upstream.pathname;
            u.port = upstream.port;
            u.protocol = upstream.protocol;
            let dnsreq = null;
            if (isGetRequest(request)) {
                u.search = "?dns=" + bytesToBase64Url(query);
                dnsreq = new Request(u.href, {
                    method: "GET",
                    headers: dnsHeaders()
                });
            } else if (isPostRequest(request)) {
                dnsreq = new Request(u.href, {
                    method: "POST",
                    headers: concatHeaders(contentLengthHeader(query), dnsHeaders()),
                    body: query
                });
            } else {
                throw new Error("get/post only");
            }
            this.log.d(rxid, "upstream doh2/fetch", u.href);
            promisedPromises.push(this.avoidFetch ? this.doh2(rxid, dnsreq) : fetch(dnsreq));
        }
    } catch (e) {
        this.log.e(rxid, "err doh2/fetch upstream", e.stack);
        promisedPromises.push(Promise.reject(e));
    }
    return Promise.any(promisedPromises);
};
DNSResolver.prototype.resolveDnsFromCache = async function(rxid, packet) {
    const k = makeHttpCacheKey(packet);
    if (!k) throw new Error("resolver: no cache-key");
    const cr = await this.cache.get(k);
    const hasAns = cr && isAnswer(cr.dnsPacket);
    const freshAns = hasAns && isAnswerFresh(cr.metadata);
    this.log.d(rxid, "cache ans", k.href, "ans?", hasAns, "fresh?", freshAns);
    if (!hasAns || !freshAns) {
        return Promise.reject(new Error("resolver: cache miss"));
    }
    updatedAnswer(cr.dnsPacket, packet.id, cr.metadata.expiry);
    const b = encode3(cr.dnsPacket);
    const r = new Response(b, {
        headers: cacheHeaders()
    });
    return Promise.resolve(r);
};
DNSResolver.prototype.doh2 = async function(rxid, request) {
    if (!this.http2 || !this.nodeutil) {
        throw new Error("h2 / node-util not setup, bailing");
    }
    this.log.d(rxid, "upstream with doh2");
    const http2 = this.http2;
    const u = new URL(request.url);
    const verb = request.method;
    const path = isGetRequest(request) ? u.pathname + u.search : u.pathname;
    const qab = await request.arrayBuffer();
    const upstreamQuery = bufferOf(qab);
    const headers1 = copyHeaders(request);
    return new Promise((resolve, reject)=>{
        if (!isGetRequest(request) && !isPostRequest(request)) {
            reject(new Error("Only GET/POST requests allowed"));
        }
        const c = http2.connect(u.origin);
        c.on("error", (err)=>{
            this.log.e(rxid, "conn fail", err.message);
            reject(err.message);
        });
        const req = c.request({
            [http2.constants.HTTP2_HEADER_METHOD]: verb,
            [http2.constants.HTTP2_HEADER_PATH]: path,
            ...headers1
        });
        req.on("response", (headers)=>{
            const b = [];
            req.on("data", (chunk)=>{
                b.push(chunk);
            });
            req.on("end", ()=>{
                const rb = concatBuf(b);
                const h = this.nodeutil.transformPseudoHeaders(headers);
                safeBox(()=>c.close()
                );
                resolve(new Response(rb, h));
            });
        });
        req.on("error", (err)=>{
            this.log.e(rxid, "send/recv fail", err.message);
            reject(err.message);
        });
        req.end(upstreamQuery);
    });
};
class DNSCacheResponder {
    constructor(blocklistWrapper, cache){
        this.blocker = new DnsBlocker();
        this.log = log.withTags("DnsCacheResponder");
        this.cache = cache;
        this.bw = blocklistWrapper;
    }
    async RethinkModule(param) {
        let response = emptyResponse();
        if (!param.isDnsMsg) {
            this.log.d(param.rxid, "not a dns-msg, nowt to resolve");
            return response;
        }
        try {
            response.data = await this.resolveFromCache(param.rxid, param.requestDecodedDnsPacket, param.userBlocklistInfo);
        } catch (e) {
            this.log.e(param.rxid, "main", e.stack);
            response = errResponse("DnsCacheHandler", e);
        }
        return response;
    }
    async resolveFromCache(rxid, packet, blockInfo) {
        const noAnswer = rdnsNoBlockResponse();
        const blf = this.bw.getBlocklistFilter();
        const onlyLocal = this.bw.disabled() || isBlocklistFilterSetup(blf);
        const k = makeHttpCacheKey(packet);
        if (!k) return noAnswer;
        const cr = await this.cache.get(k, onlyLocal);
        this.log.d(rxid, "local?", onlyLocal, "cached ans", k.href, cr);
        if (emptyObj(cr)) return noAnswer;
        const stamps = blockstampFromCache(cr);
        const res = dnsResponse(cr.dnsPacket, cr.dnsBuffer, stamps);
        this.makeCacheResponse(rxid, res, blockInfo);
        if (res.isBlocked) return res;
        if (!isAnswerFresh(cr.metadata)) {
            this.log.d(rxid, "cache ans not fresh");
            return noAnswer;
        }
        updatedAnswer(res.dnsPacket, packet.id, cr.metadata.expiry);
        const reencoded = encode3(res.dnsPacket);
        return dnsResponse(res.dnsPacket, reencoded, res.stamps);
    }
    makeCacheResponse(rxid, r, blockInfo) {
        this.blocker.blockQuestion(rxid, r, blockInfo);
        this.log.d(rxid, blockInfo, "question blocked?", r.isBlocked);
        if (r.isBlocked) {
            return r;
        }
        if (!hasAnswers(r.dnsPacket)) {
            return r;
        }
        this.blocker.blockAnswer(rxid, r, blockInfo);
        this.log.d(rxid, "answer block?", r.isBlocked);
        return r;
    }
}
class CacheApi {
    constructor(){
        this.noop = !hasHttpCache();
        if (this.noop) {
            log.w("no-op http-cache-api");
        }
    }
    async get(href) {
        if (this.noop) return false;
        if (!href) return false;
        return await caches.default.match(href);
    }
    put(href, response) {
        if (this.noop) return false;
        if (!href || !response) return false;
        return caches.default.put(href, response);
    }
}
class DnsCache {
    constructor(size){
        this.log = log.withTags("DnsCache");
        this.disabled = disableDnsCache();
        if (this.disabled) {
            this.log.w("DnsCache disabled");
            return;
        }
        this.localcache = new LfuCache("DnsCache", size);
        this.httpcache = new CacheApi();
    }
    async get(url, localOnly = false) {
        if (this.disabled) return null;
        if (!url && emptyString(url.href)) {
            this.log.d("get: empty url", url);
            return null;
        }
        let entry = this.fromLocalCache(url.href);
        if (entry) {
            return entry;
        }
        if (localOnly) return null;
        entry = await this.fromHttpCache(url);
        if (entry) {
            this.putLocalCache(url.href, entry);
        }
        return entry;
    }
    async put(url, data, dispatcher) {
        if (this.disabled) return;
        if (!url || emptyString(url.href) || emptyObj(data) || emptyObj(data.metadata) || emptyObj(data.dnsPacket) || emptyBuf(data.dnsBuffer)) {
            this.log.w("put: empty url/data", url, data);
            return;
        }
        try {
            this.log.d("put: data in cache", data);
            const c = this.fromLocalCache(url.href);
            const hasAns = !emptyObj(c) && isAnswer(c.dnsPacket);
            const incomingHasAns = isAnswer(data.dnsPacket);
            if (hasAns && !incomingHasAns) {
                this.log.w("put ignored: cache has answer, incoming does not");
                return;
            }
            this.putLocalCache(url, data);
            dispatcher(this.putHttpCache(url, data));
        } catch (e) {
            this.log.e("put", url.href, data, e.stack);
        }
    }
    putLocalCache(url, data) {
        const k = url.href;
        const v = makeLocalCacheValue(data.dnsBuffer, data.metadata);
        if (!k || !v) return;
        this.localcache.Put(k, v);
    }
    fromLocalCache(key) {
        const res = this.localcache.Get(key);
        if (emptyObj(res)) return false;
        const b = res.dnsBuffer;
        const p = decode3(b);
        const m = res.metadata;
        const cr = makeCacheValue(p, b, m);
        return isValueValid(cr) ? cr : false;
    }
    async putHttpCache(url, data) {
        const k = url.href;
        const v = makeHttpCacheValue(data.dnsBuffer, data.metadata);
        if (!k || !v) return;
        return this.httpcache.put(k, v);
    }
    async fromHttpCache(url) {
        const k = url.href;
        const response = await this.httpcache.get(k);
        if (!response || !response.ok) return false;
        const metadata = extractMetadata(response);
        this.log.d("http-cache response metadata", metadata);
        const b = await response.arrayBuffer();
        const p = decode3(b);
        const m = metadata;
        const cr = makeCacheValue(p, b, m);
        return isValueValid(cr) ? cr : false;
    }
}
const services = {
    ready: false
};
((main)=>{
    when("ready").then(systemReady);
})();
async function systemReady() {
    if (services.ready) return;
    log.i("svc", "systemReady");
    const bw = new BlocklistWrapper();
    const cache = new DnsCache(cacheSize());
    services.userOperation = new UserOperation();
    services.dnsCacheHandler = new DNSCacheResponder(bw, cache);
    services.commandControl = new CommandControl(bw);
    services.dnsResolver = new DNSResolver(bw, cache);
    await maybeSetupBlocklists(bw);
    done();
}
async function maybeSetupBlocklists(bw) {
    if (!hasDynamicImports()) return;
    if (bw.disabled()) {
        log.w("svc", "blocklists disabled");
        return;
    }
    if (isNode()) {
        const b = await import("./node/blocklists.js");
        await b.setup(bw);
    } else if (isDeno()) {
        const b = await import("./deno/blocklists.ts");
        await b.setup(bw);
    }
}
function done() {
    services.ready = true;
    pub("go");
}
class RethinkPlugin {
    constructor(event){
        if (!services.ready) throw new Error("services not ready");
        this.parameter = new Map();
        const rxid = rxidFromHeader(event.request.headers) || xid();
        this.registerParameter("rxid", "[rx." + rxid + "]");
        this.registerParameter("request", event.request);
        this.registerParameter("dispatcher", event.waitUntil.bind(event));
        this.log = log.withTags("RethinkPlugin");
        this.plugin = [];
        this.registerPlugin("userOperation", services.userOperation, [
            "rxid",
            "request",
            "isDnsMsg"
        ], this.userOperationCallBack, false);
        this.registerPlugin("cacheOnlyResolver", services.dnsCacheHandler, [
            "rxid",
            "userBlocklistInfo",
            "requestDecodedDnsPacket",
            "isDnsMsg"
        ], this.dnsCacheCallBack, false);
        this.registerPlugin("commandControl", services.commandControl, [
            "rxid",
            "request",
            "isDnsMsg"
        ], this.commandControlCallBack, false);
        this.registerPlugin("dnsResolver", services.dnsResolver, [
            "rxid",
            "dispatcher",
            "request",
            "userDnsResolverUrl",
            "userBlocklistInfo",
            "domainBlockstamp",
            "requestDecodedDnsPacket",
            "requestBodyBuffer", 
        ], this.dnsResolverCallBack, false);
    }
    registerParameter(k, v) {
        this.parameter.set(k, v);
    }
    registerPlugin(pluginName, module, parameter, callBack, continueOnStopProcess) {
        this.plugin.push({
            name: pluginName,
            module: module,
            param: parameter,
            callBack: callBack,
            continueOnStopProcess: continueOnStopProcess
        });
    }
    async executePlugin(req) {
        await this.setRequest(req);
        const rxid = this.parameter.get("rxid");
        const t = this.log.startTime("exec-plugin-" + rxid);
        for (const p of this.plugin){
            if (req.stopProcessing && !p.continueOnStopProcess) {
                continue;
            }
            this.log.lapTime(t, rxid, p.name, "send-req");
            const res = await p.module.RethinkModule(generateParam(this.parameter, p.param));
            this.log.lapTime(t, rxid, p.name, "got-res");
            if (p.callBack) {
                await p.callBack.call(this, res, req);
            }
            this.log.lapTime(t, rxid, p.name, "post-callback");
        }
        this.log.endTime(t);
    }
    async commandControlCallBack(response, currentRequest) {
        const rxid = this.parameter.get("rxid");
        const r = response.data;
        this.log.d(rxid, "command-control response");
        if (!emptyObj(r) && r.stopProcessing) {
            this.log.d(rxid, "command-control reply", r);
            currentRequest.hResponse(r.httpResponse);
        }
    }
    async userOperationCallBack(response, currentRequest) {
        const rxid = this.parameter.get("rxid");
        const r = response.data;
        this.log.d(rxid, "user-op response");
        if (response.isException) {
            this.log.w(rxid, "unexpected err userOp", r);
            this.loadException(rxid, response, currentRequest);
        } else if (!emptyObj(r)) {
            this.registerParameter("userBlocklistInfo", r.userBlocklistInfo);
            this.registerParameter("userDnsResolverUrl", r.dnsResolverUrl);
        } else {
            this.log.i(rxid, "user-op is a no-op, possibly a command-control req");
        }
    }
    dnsCacheCallBack(response, currentRequest) {
        const rxid = this.parameter.get("rxid");
        const r = response.data;
        const deny = r.isBlocked;
        const isAns = isAnswer(r.dnsPacket);
        const noErr = rcodeNoError(r.dnsPacket);
        this.log.d(rxid, "crr: block?", deny, "ans?", isAns, "noerr", noErr);
        if (response.isException) {
            this.loadException(rxid, response, currentRequest);
        } else if (deny) {
            currentRequest.dnsBlockResponse(r.flag);
        } else if (isAns) {
            this.registerParameter("responseBodyBuffer", r.dnsBuffer);
            this.registerParameter("responseDecodedDnsPacket", r.dnsPacket);
            currentRequest.dnsResponse(r.dnsBuffer, r.dnsPacket, r.flag);
        } else {
            this.registerParameter("domainBlockstamp", r.stamps);
            this.log.d(rxid, "resolve query; no response from cache-handler");
        }
    }
    dnsResolverCallBack(response, currentRequest) {
        const rxid = this.parameter.get("rxid");
        const r = response.data;
        const deny = r.isBlocked;
        const isAns = isAnswer(r.dnsPacket);
        const noErr = rcodeNoError(r.dnsPacket);
        this.log.d(rxid, "rr: block?", deny, "ans?", isAns, "noerr?", noErr);
        if (deny) {
            currentRequest.dnsBlockResponse(r.flag);
        } else if (response.isException || !isAns) {
            this.loadException(rxid, response, currentRequest);
        } else {
            this.registerParameter("responseBodyBuffer", r.dnsBuffer);
            this.registerParameter("responseDecodedDnsPacket", r.dnsPacket);
            currentRequest.dnsResponse(r.dnsBuffer, r.dnsPacket, r.flag);
        }
    }
    loadException(rxid, response, currentRequest) {
        this.log.e(rxid, "exception", JSON.stringify(response));
        currentRequest.dnsExceptionResponse(response);
    }
    async setRequest(currentRequest) {
        const request = this.parameter.get("request");
        const isDnsMsg2 = isDnsMsg(request);
        const rxid = this.parameter.get("rxid");
        currentRequest.id(rxid);
        this.registerParameter("isDnsMsg", isDnsMsg2);
        if (!isDnsMsg2) {
            if (!isGetRequest(request)) {
                this.log.i(rxid, "not a dns-msg, not a GET req either", request);
                currentRequest.hResponse(respond405());
            }
            return;
        }
        const question1 = await extractDnsQuestion(request);
        const questionPacket = decode3(question1);
        this.log.d(rxid, "cur-ques", JSON.stringify(questionPacket.questions));
        currentRequest.decodedDnsPacket = questionPacket;
        this.registerParameter("requestDecodedDnsPacket", questionPacket);
        this.registerParameter("requestBodyBuffer", question1);
    }
}
function generateParam(parameter, list) {
    const out = {};
    for (const key of list){
        out[key] = parameter.get(key) || null;
    }
    return out;
}
async function extractDnsQuestion(request) {
    if (isPostRequest(request)) {
        return await request.arrayBuffer();
    } else {
        const queryString = new URL(request.url).searchParams;
        const dnsQuery = queryString.get("dns");
        return base64ToBytes(dnsQuery);
    }
}
function handleRequest(event) {
    return proxyRequest(event);
}
async function proxyRequest(event) {
    if (optionsRequest(event.request)) return respond204();
    const cr = new CurrentRequest();
    try {
        const plugin = new RethinkPlugin(event);
        await timedSafeAsyncOp(async ()=>plugin.executePlugin(cr)
        , requestTimeout(), async ()=>errorResponse(cr)
        );
    } catch (err) {
        log.e("doh", "proxy-request error", err.stack);
        errorResponse(cr, err);
    }
    const ua = event.request.headers.get("User-Agent");
    if (fromBrowser(ua)) cr.setCorsHeadersIfNeeded();
    return cr.httpResponse;
}
function optionsRequest(request) {
    return request.method === "OPTIONS";
}
function errorResponse(currentRequest, err = null) {
    const eres = errResponse("doh.js", err);
    currentRequest.dnsExceptionResponse(eres);
}
function delay(ms, options = {}) {
    const { signal  } = options;
    if (signal?.aborted) {
        return Promise.reject(new DOMException("Delay was aborted.", "AbortError"));
    }
    return new Promise((resolve, reject)=>{
        const abort = ()=>{
            clearTimeout(i33);
            reject(new DOMException("Delay was aborted.", "AbortError"));
        };
        const done1 = ()=>{
            signal?.removeEventListener("abort", abort);
            resolve();
        };
        const i33 = setTimeout(done1, ms);
        signal?.addEventListener("abort", abort, {
            once: true
        });
    });
}
const ERROR_SERVER_CLOSED = "Server closed";
const INITIAL_ACCEPT_BACKOFF_DELAY = 5;
const MAX_ACCEPT_BACKOFF_DELAY = 1000;
class Server {
    #port;
    #host;
    #handler;
    #closed = false;
    #listeners = new Set();
    #httpConnections = new Set();
    #onError;
    constructor(serverInit){
        this.#port = serverInit.port;
        this.#host = serverInit.hostname;
        this.#handler = serverInit.handler;
        this.#onError = serverInit.onError ?? function(error) {
            console.error(error);
            return new Response("Internal Server Error", {
                status: 500
            });
        };
    }
    async serve(listener) {
        if (this.#closed) {
            throw new Deno.errors.Http(ERROR_SERVER_CLOSED);
        }
        this.#trackListener(listener);
        try {
            return await this.#accept(listener);
        } finally{
            this.#untrackListener(listener);
            try {
                listener.close();
            } catch  {}
        }
    }
    async listenAndServe() {
        if (this.#closed) {
            throw new Deno.errors.Http(ERROR_SERVER_CLOSED);
        }
        const listener = Deno.listen({
            port: this.#port ?? 80,
            hostname: this.#host ?? "0.0.0.0",
            transport: "tcp"
        });
        return await this.serve(listener);
    }
    async listenAndServeTls(certFile, keyFile) {
        if (this.#closed) {
            throw new Deno.errors.Http(ERROR_SERVER_CLOSED);
        }
        const listener = Deno.listenTls({
            port: this.#port ?? 443,
            hostname: this.#host ?? "0.0.0.0",
            certFile,
            keyFile,
            transport: "tcp"
        });
        return await this.serve(listener);
    }
    close() {
        if (this.#closed) {
            throw new Deno.errors.Http(ERROR_SERVER_CLOSED);
        }
        this.#closed = true;
        for (const listener of this.#listeners){
            try {
                listener.close();
            } catch  {}
        }
        this.#listeners.clear();
        for (const httpConn of this.#httpConnections){
            this.#closeHttpConn(httpConn);
        }
        this.#httpConnections.clear();
    }
    get closed() {
        return this.#closed;
    }
    get addrs() {
        return Array.from(this.#listeners).map((listener)=>listener.addr
        );
    }
    async #respond(requestEvent, httpConn, connInfo) {
        let response;
        try {
            response = await this.#handler(requestEvent.request, connInfo);
        } catch (error) {
            response = await this.#onError(error);
        }
        try {
            await requestEvent.respondWith(response);
        } catch  {
            return this.#closeHttpConn(httpConn);
        }
    }
    async #serveHttp(httpConn1, connInfo1) {
        while(!this.#closed){
            let requestEvent;
            try {
                requestEvent = await httpConn1.nextRequest();
            } catch  {
                break;
            }
            if (requestEvent === null) {
                break;
            }
            this.#respond(requestEvent, httpConn1, connInfo1);
        }
        this.#closeHttpConn(httpConn1);
    }
    async #accept(listener) {
        let acceptBackoffDelay;
        while(!this.#closed){
            let conn;
            try {
                conn = await listener.accept();
            } catch (error) {
                if (error instanceof Deno.errors.BadResource || error instanceof Deno.errors.InvalidData || error instanceof Deno.errors.UnexpectedEof || error instanceof Deno.errors.ConnectionReset || error instanceof Deno.errors.NotConnected) {
                    if (!acceptBackoffDelay) {
                        acceptBackoffDelay = INITIAL_ACCEPT_BACKOFF_DELAY;
                    } else {
                        acceptBackoffDelay *= 2;
                    }
                    if (acceptBackoffDelay >= 1000) {
                        acceptBackoffDelay = MAX_ACCEPT_BACKOFF_DELAY;
                    }
                    await delay(acceptBackoffDelay);
                    continue;
                }
                throw error;
            }
            acceptBackoffDelay = undefined;
            let httpConn;
            try {
                httpConn = Deno.serveHttp(conn);
            } catch  {
                continue;
            }
            this.#trackHttpConnection(httpConn);
            const connInfo = {
                localAddr: conn.localAddr,
                remoteAddr: conn.remoteAddr
            };
            this.#serveHttp(httpConn, connInfo);
        }
    }
     #closeHttpConn(httpConn2) {
        this.#untrackHttpConnection(httpConn2);
        try {
            httpConn2.close();
        } catch  {}
    }
     #trackListener(listener1) {
        this.#listeners.add(listener1);
    }
     #untrackListener(listener2) {
        this.#listeners.delete(listener2);
    }
     #trackHttpConnection(httpConn3) {
        this.#httpConnections.add(httpConn3);
    }
     #untrackHttpConnection(httpConn4) {
        this.#httpConnections.delete(httpConn4);
    }
}
async function serve(handler, options = {}) {
    const server = new Server({
        port: options.port ?? 8000,
        hostname: options.hostname ?? "0.0.0.0",
        handler,
        onError: options.onError
    });
    if (options?.signal) {
        options.signal.onabort = ()=>server.close()
        ;
    }
    return await server.listenAndServe();
}
async function serveTls(handler, options) {
    if (!options.keyFile) {
        throw new Error("TLS config is given, but 'keyFile' is missing.");
    }
    if (!options.certFile) {
        throw new Error("TLS config is given, but 'certFile' is missing.");
    }
    const server = new Server({
        port: options.port ?? 8443,
        hostname: options.hostname ?? "0.0.0.0",
        handler,
        onError: options.onError
    });
    if (options?.signal) {
        options.signal.onabort = ()=>server.close()
        ;
    }
    return await server.listenAndServeTls(options.certFile, options.keyFile);
}
let log1 = null;
((main)=>{
    sub("go", systemUp);
    pub("prepare");
})();
function systemUp() {
    const onDenoDeploy2 = onDenoDeploy();
    const dohConnOpts = {
        port: dohBackendPort()
    };
    const dotConnOpts = {
        port: dotBackendPort()
    };
    const tlsOpts = {
        certFile: tlsCrtPath(),
        keyFile: tlsKeyPath()
    };
    const httpOpts = {
        alpnProtocols: [
            "h2",
            "http/1.1"
        ]
    };
    log1 = logger("Deno");
    if (!log1) throw new Error("logger unavailable on system up");
    startDoh();
    startDotIfPossible();
    async function startDoh() {
        if (terminateTls()) {
            serveTls(serveDoh, {
                ...dohConnOpts,
                ...tlsOpts,
                ...httpOpts
            });
        } else {
            serve(serveDoh, {
                ...dohConnOpts
            });
        }
        up("DoH", dohConnOpts);
    }
    async function startDotIfPossible() {
        if (onDenoDeploy2) return;
        const dot = terminateTls() ? Deno.listenTls({
            ...dotConnOpts,
            ...tlsOpts
        }) : Deno.listen({
            ...dotConnOpts
        });
        up("DoT (no blocklists)", dotConnOpts);
        for await (const conn of dot){
            log1.d("DoT conn:", conn.remoteAddr);
            serveTcp(conn);
        }
    }
    function up(p, opts) {
        log1.i("up", p, opts, "tls?", terminateTls());
    }
    function terminateTls() {
        if (onDenoDeploy2) return false;
        if (emptyString(tlsOpts.keyFile)) return false;
        if (emptyString(tlsOpts.certFile)) return false;
        return true;
    }
}
async function serveDoh(req) {
    try {
        return handleRequest(mkFetchEvent(req));
    } catch (e) {
        log1.w("doh fail", e);
    }
}
async function serveTcp(conn) {
    const qlBuf = new Uint8Array(2);
    while(true){
        let n = null;
        try {
            n = await conn.read(qlBuf);
        } catch (e) {
            log1.w("err tcp query read", e);
            break;
        }
        if (n == 0 || n == null) {
            log1.d("tcp socket clean shutdown");
            break;
        }
        if (n < 2) {
            log1.w("query too small");
            break;
        }
        const ql = new DataView(qlBuf.buffer).getUint16(0);
        log1.d(`Read ${n} octets; q len = ${qlBuf} = ${ql}`);
        const q = new Uint8Array(ql);
        n = await conn.read(q);
        log1.d(`Read ${n} length q`);
        if (n != ql) {
            log1.w(`query len mismatch: ${n} < ${ql}`);
            break;
        }
        await handleTCPQuery(q, conn);
    }
    conn.close();
}
async function handleTCPQuery(q, conn) {
    try {
        const r = await resolveQuery(q);
        const rlBuf = encodeUint8ArrayBE(r.byteLength, 2);
        const n = await conn.write(new Uint8Array([
            ...rlBuf,
            ...r
        ]));
        if (n != r.byteLength + 2) {
            log1.e(`res write incomplete: ${n} < ${r.byteLength + 2}`);
        }
    } catch (e) {
        log1.w("err tcp query resolve", e);
    }
}
async function resolveQuery(q) {
    const freq = new Request("https://ignored.example.com", {
        method: "POST",
        headers: concatHeaders(dnsHeaders(), contentLengthHeader(q)),
        body: q
    });
    const r = await handleRequest(mkFetchEvent(freq));
    const ans = await r.arrayBuffer();
    if (!emptyBuf(ans)) {
        return new Uint8Array(ans);
    } else {
        return new Uint8Array(servfailQ(q));
    }
}
function mkFetchEvent(r, ...fns) {
    if (!r) throw new Error("missing request");
    return {
        type: "fetch",
        request: r,
        respondWith: fns[0] || stub1("event.respondWith"),
        waitUntil: fns[1] || stub1("event.waitUntil"),
        passThroughOnException: fns[2] || stub1("event.passThroughOnException")
    };
}
function stub1(fid) {
    return (...rest)=>log1.d(fid, "stub fn, args:", ...rest)
    ;
}
