import * as system from "../../system.js";
import * as blocklists from "./blocklists.ts";
import * as dbip from "./dbip.ts";
import { services, stopAfter } from "../svc.js";
import Log, { LogLevels } from "../log.js";
import EnvManager from "../env.js";
import { signal } from "https://deno.land/std@0.171.0/signal/mod.ts";

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
  system.when("prepare").then(prep);
  system.when("steady").then(up);
})();

async function sigctrl() {
  const sigs = signal("SIGINT");
  for await (const _ of sigs) {
    stopAfter();
  }
}

async function prep() {
  // if this file execs... assume we're on deno.
  if (!Deno) throw new Error("failed loading deno-specific config");

  const isProd = Deno.env.get("DENO_ENV") === "production";
  const onDenoDeploy = Deno.env.get("CLOUD_PLATFORM") === "deno-deploy";
  const profiling = Deno.env.get("PROFILE_DNS_RESOLVES") === "true";

  window.envManager = new EnvManager();

  window.log = new Log({
    level: window.envManager.get("LOG_LEVEL") as LogLevels,
    levelize: isProd || profiling, // levelize if prod or profiling
    withTimestamps: !onDenoDeploy, // do not log ts on deno-deploy
  });

  // signal ready
  system.pub("ready");
}

async function up() {
  if (!services.ready) {
    console.error("services not yet ready and there is a sig-up!?");
    return;
  }

  const bw = services.blocklistWrapper;
  if (bw != null && !bw.disabled()) {
    await blocklists.setup(bw);
  } else {
    console.warn("Config", "blocklists unavailable / disabled");
  }
  const lp = services.logPusher;
  if (lp != null) {
    try {
      await dbip.setup(lp);
    } catch (ex) {
      console.error("Config", "dbip setup failed", ex);
    }
  } else {
    console.warn("Config", "logpusher unavailable");
  }
  sigctrl();
  // signal all system are-a go
  system.pub("go");
}
