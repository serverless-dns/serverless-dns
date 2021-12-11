/**
 * Encodes a number to an Uint8Array of length `n` in Big Endian byte order.
 * https://stackoverflow.com/questions/55583037/
 * @param {Number} n - Number to encode
 * @param {Number} len - Length of Array required
 * @returns
 */
export function encodeUint8ArrayBE(n, len) {
  const o = n;

  if (!n) return new Uint8Array(len);

  const a = [];
  a.unshift(n & 255);
  while (n >= 256) {
    n = n >>> 8;
    a.unshift(n & 255);
  }

  if (a.length > len) {
    throw new RangeError(`Cannot encode ${o} in ${len} len Uint8Array`);
  }

  let fill = len - a.length;
  while (fill--) a.unshift(0);

  return new Uint8Array(a);
}

/**
 * Promise that resolves after `ms`
 * @param {number} ms - Milliseconds to sleep
 * @returns
 */
export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
