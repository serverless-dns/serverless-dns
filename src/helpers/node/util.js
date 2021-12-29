/**
 * @param {String} TLS_CRT_KEY - Contains base64 (no wrap) encoded key and
 * certificate files seprated by a newline (\n) and described by `KEY=` and
 * `CRT=` respectively. Ex: `TLS_="KEY=encoded_string\nCRT=encoded_string"`
 * @return {Array<Buffer>} [TLS_KEY, TLS_CRT]
 */
export function getTLSfromEnv(TLS_CRT_KEY) {
  if (TLS_CRT_KEY == null) throw new Error("TLS cert / key not found");

  TLS_CRT_KEY = TLS_CRT_KEY.replace(/\\n/g, "\n");

  if (TLS_CRT_KEY.split("=", 1)[0].indexOf("KEY") >= 0) {
    return TLS_CRT_KEY.split("\n").map((v) =>
      Buffer.from(v.substring(v.indexOf("=") + 1), "base64")
    );
  } else if (TLS_CRT_KEY.split("\n")[1].split("=", 1)[0].indexOf("KEY") >= 0) {
    return TLS_CRT_KEY.split("\n")
      .reverse()
      .map((v) => Buffer.from(v.substring(v.indexOf("=") + 1), "base64"));
  } else throw new Error("TLS cert / key malformed");
}

/**
 * @param {Object} headers
 * @return {Object}
 */
export function copyNonPseudoHeaders(headers) {
  const resH = {};
  if (!headers) return resH;

  // drop http/2 pseudo-headers
  for (const name in headers) {
    if (name.startsWith(":")) continue;
    resH[name] = headers[name];
  }
  return resH;
}

/**
 * @param {Object} headers
 * @return {Object}
 */
export function transformPseudoHeaders(headers) {
  const resH = {};
  if (!headers) return resH;

  // Transform http/2 pseudo-headers
  for (const name in headers) {
    if (name.startsWith(":")) resH[name.slice(1)] = headers[name];
    else resH[name] = headers[name];
  }
  return resH;
}
