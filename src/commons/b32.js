// SPDX-License-Identifier: MIT
// Copyright (c) 2016-2021 Linus Unnebäck
// from github.com/LinusU/base32-encode/blob/b970e2ee5/index.js
// and github.com/LinusU/base32-decode/blob/fa61c01b/index.js
// and github.com/LinusU/to-data-view/blob/e80ca034/index.js
const ALPHA32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
// map chars to corresponding indices,
// ex: A => 0, B => 1, ... Z => 25, 2 => 26, 3 => 27, ... 7 => 31
const RALPHA32 = ALPHA32.split("").reduce((o, c, i) => {
  o[c] = i;
  return o;
}, {});

function toDataView(data) {
  if (
    data instanceof Int8Array ||
    data instanceof Uint8Array ||
    data instanceof Uint8ClampedArray
  ) {
    return new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  if (data instanceof ArrayBuffer) {
    return new DataView(data);
  }

  return null;
}

function readChar(chr) {
  chr = chr.toUpperCase();
  const idx = RALPHA32[chr];

  if (idx == null) {
    throw new Error("invalid b32 character: " + chr);
  }

  return idx;
}

function base32(arrbuf, padding) {
  const view = toDataView(arrbuf);
  if (!view) throw new Error("cannot create data-view from given input");

  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < view.byteLength; i++) {
    value = (value << 8) | view.getUint8(i);
    bits += 8;

    while (bits >= 5) {
      output += ALPHA32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += ALPHA32[(value << (5 - bits)) & 31];
  }

  if (padding) {
    while (output.length % 8 !== 0) {
      output += "=";
    }
  }

  return output;
}

export function rbase32(input) {
  input = input.replace(/=+$/, "");

  const length = input.length;

  let bits = 0;
  let value = 0;

  let index = 0;
  const output = new Uint8Array(((length * 5) / 8) | 0);

  for (let i = 0; i < length; i++) {
    value = (value << 5) | readChar(input[i]);
    bits += 5;

    if (bits >= 8) {
      output[index++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return output;
}
