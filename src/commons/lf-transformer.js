/*
 * Copyright (c) 2023 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// ref: gist.github.com/stefandanaita/88c4d8b187400d5b07524cd0a12843b2

/**
 * @implements {Transformer<string, string>}
 */
export class LfTransformer {
  /**
   * @param {StreamType<string|Uint8Array>} typ
   * @constructor
   * @implements {Transformer<string, string>}
   * @see https://developer.mozilla.org/en-US/docs/Web/API/TransformStream
   * @see https://developer.mozilla.org/en-US/docs/Web/API/TransformStreamDefaultController
   */
  constructor(typ) {
    /** @type {StreamType<string|Uint8Array>} */
    this.typ = typ;

    /** @type {Uint8Array|string} */
    this.partial = this.typ.empty();
  }

  /**
   * @param {Uint8Array|string} chunk
   * @param {TransformStreamDefaultController<Uint8Array|string>} controller
   */
  transform(chunk, controller) {
    // prepend with previous string (empty if none)
    const cat = this.typ.concat(this.partial, chunk);
    // Extract lines from chunk
    const lines = this.typ.split(cat);
    // Save last line as it might be incomplete
    this.partial = lines.pop() || this.typ.empty();

    // eslint-disable-next-line no-restricted-syntax
    for (const l of lines) {
      if (this.typ.include(l)) {
        const incl = this.typ.concat(l, this.typ.separator);
        controller.enqueue(incl);
      }
    }
  }

  /**
   * @param {TransformStreamDefaultController<Uint8Array|string>} controller
   */
  flush(controller) {
    const p = this.partial;
    if (this.typ.len(p) > 0) controller.enqueue(p);
  }
}

export const bufstream = (strfilter) =>
  new TransformStream(new LfTransformer(new ByteType(strfilter)));

export const strstream = (strfilter) =>
  new TransformStream(new LfTransformer(new StrType(strfilter)));

/**
 * @param {ReadableStream<string>} stream
 * @returns {AsyncIterableIterator<Uint8Array>}
 */
export async function* streamiter(stream) {
  // Get a lock on the stream
  const reader = stream.getReader();

  try {
    while (true) {
      // Read from the stream
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * @template [T=Uint8Array]
 * @implements {StreamType}
 */
class ByteType {
  constructor(strfilter, strsep = "\n") {
    const enc = new TextEncoder();
    this.separator = enc.encode(strsep);
    this.filter = enc.encode(strfilter);
  }

  name() {
    return "Byte";
  }

  empty() {
    return new Uint8Array(0);
  }

  concat(buf1, buf2) {
    const cat = new Uint8Array(buf1.length + buf2.length);
    cat.set(buf1, 0);
    cat.set(buf2, buf1.length);
    return cat;
  }

  split(buf) {
    const sep = this.separator[0];
    const w = [];
    w.push(
      buf.reduce((acc, x) => {
        if (x === sep) {
          w.push(acc);
          return [];
        } else {
          acc.push(x);
          return acc;
        }
      }, [])
    );
    for (let i = 0; i < w.length; i++) {
      if (w[i].length === 0) continue;
      w[i] = Uint8Array.from(w[i]);
    }
    return w;
  }

  indexOf(buf, me, limit) {
    if (!me || me.length === 0) return -2;
    if (this.len(buf) === 0) return -3;

    const ml = me.length - 1;
    const bl = buf.length > limit ? limit : buf.length;

    if (bl < ml) return -4;

    // ex: buf [0, 1, 4, 6, 7, 2]; me [4, 6, 7]
    // ml => 2; bl - ml => 4
    for (let i = 0; i < bl - ml; i++) {
      // check if first & last bytes of 'me' match with 'buf'
      const start = buf[i] === me[0];
      const end = buf[i + ml] === me[ml];
      // if not, continue
      if (!start || !end) continue;

      // if yes, check if 'me' is less than 2 bytes long
      // then, return index where 'me' was found in 'buf'
      if (ml === 0 || ml === 1) return i;

      // if not, check if the rest of 'me' matches with 'buf'
      for (let j = 1, k = i + 1; j < ml; j++, k++) {
        // on any mismatch, break out of loop
        if (buf[k] !== me[j]) break;
        // if entire 'me' matches, return idx where 'me' was found in 'buf'
        if (j + 1 >= ml) return k - j;
      }
    }

    return -1;
  }

  // search for 'this.filter' in 'buf' up to 'limit' bytes
  include(buf, limit = 200) {
    return this.indexOf(buf, this.filter, limit) >= 0;
  }

  len(buf) {
    return buf.byteLength;
  }
}

/**
 * @template [T=string]
 * @implements {StreamType}
 */
class StrType {
  constructor(strfilter, strsep = "/[\r\n]+/") {
    this.separator = strsep;
    this.filter = strfilter;
  }

  name() {
    return "Str";
  }

  empty() {
    return "";
  }

  concat(s1, s2) {
    return s1 + s2;
  }

  split(s) {
    const sep = this.separator[0];
    return s.split(sep);
  }

  include(s) {
    return s && s.include(this.filter);
  }

  len(s) {
    return s.length;
  }
}

/**
 * @template T
 * @interface
 */
class StreamType {
  /**
   * @returns {string}
   */
  name() {}

  /**
   * @returns {T}
   * @abstract
   */
  empty() {}

  /**
   * @param {T} arg1
   * @param {T} arg2
   * @returns {T}
   * @abstract
   */
  concat(arg1, arg2) {}

  /**
   * @param {T} arg1
   * @returns {T[]}
   * @abstract
   */
  split(arg1) {}

  /**
   * @param {T} arg1
   * @returns {boolean}
   * @abstract
   */
  include(arg1) {}

  /**
   * @param {T} arg1
   * @returns {number}
   * @abstract
   */
  len(arg1) {}
}
