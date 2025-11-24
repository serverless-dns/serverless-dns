import { LfuCache } from "@serverless-dns/lfu-cache";
import * as bufutil from "../commons/bufutil.js";
import { csprng, hkdfraw, sha512 } from "../commons/crypto.js";
import * as envutil from "../commons/envutil.js";
import * as system from "../system.js";
import { log } from "./log.js";

export const minkeyentropy = 32; // bytes; www.rfc-editor.org/rfc/rfc9257.html#name-provisioning-examples
const minidlen = 32; // bytes; sufficiently large to avoid collisions
const pskcachesize = 1000; // entries
export const serverid = "888811119999";
/** @type {ArrayBuffer?} */
let sessionSecret = null; // lazily initialized
// hex: 790bb45383670663ce9a39480be2de5426179506c8a6b2be922af055896438dd06dd320e68cd81348a32d679c026f73be64fdbbc46c43bfbc0f98160ffae2452
export const fixedID64 = new Uint8Array([
  121, 11, 180, 83, 131, 103, 6, 99, 206, 154, 57, 72, 11, 226, 222, 84, 38, 23,
  149, 6, 200, 166, 178, 190, 146, 42, 240, 85, 137, 100, 56, 221, 6, 221, 50,
  14, 104, 205, 129, 52, 138, 50, 214, 121, 192, 38, 247, 59, 230, 79, 219, 188,
  70, 196, 59, 251, 192, 249, 129, 96, 255, 174, 36, 82,
]);
// hex: 44f402e79d913299d0396479d002cd1243a43e15287de6e61a5cc7bee963755c123a955734d7695a939766af258614ebf164d79b11b7c644222cab0891a6e3ce
const pskfixedsalt = new Uint8Array([
  68, 244, 2, 231, 157, 145, 50, 153, 208, 57, 100, 121, 208, 2, 205, 18, 67,
  164, 62, 21, 40, 125, 230, 230, 26, 92, 199, 190, 233, 99, 117, 92, 18, 58,
  149, 87, 52, 215, 105, 90, 147, 151, 102, 175, 37, 134, 20, 235, 241, 100,
  215, 155, 17, 183, 198, 68, 34, 44, 171, 8, 145, 166, 227, 206,
]);
const pskfixedctx = bufutil.fromStr("pskkeyfixedderivationcontext");

/** @type {PskCred?} */
export const recentPskCreds = new LfuCache("psk", pskcachesize);

((_main) => {
  system.when("steady").then(up);
})();

export class PskCred {
  /** @type {Uint8Array} client id */
  id;
  /** @type {Uint8Array} client key */
  key;
  /** @type {string} client identity */
  idhex;
  /** @type {string} shared secret as hex */
  keyhex;

  /**
   *
   * @param {Uint8Array} id
   * @param {Uint8Array} key
   */
  constructor(id, key) {
    if (bufutil.len(id) < minidlen || bufutil.len(key) < minkeyentropy) {
      throw new Error("pskcred: invalid id/key size");
    }
    this.id = bufutil.normalize8(id);
    this.key = bufutil.normalize8(key);
    this.idhex = bufutil.hex(this.id);
    this.keyhex = bufutil.hex(this.key);
  }

  json() {
    return { id: this.idhex, psk: this.keyhex };
  }

  ok() {
    return (
      bufutil.len(this.id) >= minidlen && bufutil.len(this.key) >= minkeyentropy
    );
  }
}

// lazily init with "prep()" is due to limitations imposed on Workers.
// ✘ core:user:serverless-dns: Uncaught Error: Disallowed operation called within global scope.
// Asynchronous I/O (ex: fetch() or connect()), setting a timeout, and generating random values
// are not allowed within global scope. To fix this error, perform this operation within a handler.
// https://developers.cloudflare.com/workers/runtime-apis/handlers/
async function up() {
  const ok = await resetSessionSecret(bufutil.fromB64(envutil.secretb64()));
  const staticpsk = await generateTlsPsk(fixedID64);
  log.i("psk: up; static/dynamic?", staticpsk != null, ok);
}

/**
 * Returns PSK identity (random 32 bytes as hex) and PSK key derived from KDF_SVC secret.
 * @param {BufferSource?} [clientid]
 * @returns {Promise<PskCred?>}
 */
export async function generateTlsPsk(clientid) {
  if (!envutil.allowTlsPsk()) {
    return null;
  }

  if (bufutil.emptyBuf(clientid)) {
    clientid = csprng(minidlen);
  } else {
    if (bufutil.len(clientid) < minidlen) {
      log.e("psk: client id too short", bufutil.hex(clientid));
      return null;
    }
    // TODO: there's no invalidation even if sessionSecret changes
    const idhex = bufutil.hex(clientid);
    const cachedcred = recentPskCreds.get(idhex);
    if (cachedcred && cachedcred.ok()) {
      return cachedcred;
    }
  }
  // www.rfc-editor.org/rfc/rfc9257.html#section-8
  // www.rfc-editor.org/rfc/rfc9258.html#section-4
  if (bufutil.emptyBuf(sessionSecret)) {
    log.e("psk: no session secret set yet");
    return null;
  }

  // www.rfc-editor.org/rfc/rfc9257.html#section-4.2
  const clientpsk = await hkdfraw(sessionSecret, clientid);

  const c = new PskCred(clientid, clientpsk);
  recentPskCreds.put(c.idhex, c);
  return c;
}

/**
 * Resets session secret for dynamic PSK Identity & Key derivations and authentications.
 * @param {Uint8Array} seed
 * @param {string?} newctxstr
 * @returns {Promise<boolean>}
 */
export async function resetSessionSecret(seed, newctxstr) {
  if (bufutil.emptyBuf(seed)) {
    log.e("psk: new session missing secret");
    return false;
  }

  const ctx = newctxstr ? bufutil.fromStr(newctxstr) : pskfixedctx;
  const info512 = await sha512(ctx);

  // log.d("psk: new w", bufutil.hex(oldsecret.slice(0, 16)), "+", newctxstr);
  sessionSecret = await hkdfraw(seed, info512, pskfixedsalt);
  log.i("psk: new session secret", bufutil.len(sessionSecret), "bytes");
  return true;
}
