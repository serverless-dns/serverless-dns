import { config as dotEnvConfig } from "dotenv";
import * as system from "../../system.js";
import Log from "../log.js";

(main => {
  if (!Deno) throw new Error("failed loading deno-specific config");

  const isProd = Deno.env.get("DENO_ENV") === "production";

  // Load env variables from .env file to Deno.env (if file exists)
  try {
    dotEnvConfig({ export: true });
    // override: if we are running this file, then we're on Deno
    Deno.env.set("RUNTIME", "deno");
  } catch (e) {
    // throws without --allow-read flag
    console.warn(".env file may not be loaded => ", e.name, ":", e.message);
  }

  globalThis.envManager = new EnvManager();

  globalThis.log = new Log(
    env.logLevel,
    isProd // set console level only in prod.
  );

  system.pub("ready");
}();

