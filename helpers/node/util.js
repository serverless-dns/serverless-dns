/**
 * @param {String} TLS_CRT_KEY - Contains base64 (no wrap) encoded key and
 * certificate files seprated by a newline (\n) and described by `KEY=` and
 * `CRT=` respectively. Ex: `TLS_="KEY=encoded_string\nCRT=encoded_string"`
 * @returns [TLS_KEY, TLS_CRT]
 */
export function getTLSfromEnv(TLS_CRT_KEY) {
  if (TLS_CRT_KEY == undefined) throw new Error("TLS cert / key not found");

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
