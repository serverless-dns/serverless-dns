import { config as dotEnvConfig } from "dotenv";
import * as system from "../../system.js";
import Log from "../log.js";
import EnvManager from "../env.js";

// In global scope.
declare global {
  // TypeScript must know type of every var / property. Extend Window
  // (globalThis) with declaration merging (archive.is/YUWh2) to define types
  // Ref: www.typescriptlang.org/docs/handbook/declaration-merging.html
  interface Window {
    envManager?: EnvManager;
    log?: Log;
    env?: any;
  }
}

((main) => {
  system.when("prepare").then(setup);
})();

function setup() {
  // if this file execs... assume we're on deno.
  if (!Deno) throw new Error("failed loading deno-specific config");

  // Load env variables from .env file to Deno.env (if file exists)
  try {
    dotEnvConfig({ export: true });
  } catch (e) {
    // throws without --allow-read flag
    console.warn(".env missing => ", e.name, e.message);
  }

  const isProd = Deno.env.get("DENO_ENV") === "production";
  const onDenoDeploy = Deno.env.get("CLOUD_PLATFORM") === "deno-deploy";
  const profiling = Deno.env.get("PROFILE_DNS_RESOLVES") === "true";

  window.envManager = new EnvManager();

  window.log = new Log({
    level: window.envManager.get("LOG_LEVEL") as string,
    levelize: isProd || profiling, // levelize if prod or profiling
    withTimestamps: !onDenoDeploy, // do not log ts on deno-deploy
  });

  system.pub("ready");
}
