// deno-lint-ignore-file no-var
import * as system from "../../system.js";
import * as blocklists from "./blocklists.ts";
import * as dbip from "./dbip.ts";
import { services, stopAfter } from "../svc.js";
import Log, { LogLevels } from "../log.js";
import EnvManager from "../env.js";

// In global scope.
declare global {
  // TypeScript must know type of every var / property. Extend Window
  // (globalThis) with declaration merging (archive.is/YUWh2) to define types
  // Ref: www.typescriptlang.org/docs/handbook/declaration-merging.html
  var envManager: EnvManager | null;
  var log: Log | null;
  var env: any | null;
}

((main) => {
  system.when("prepare").then(prep);
  system.when("steady").then(up);
})();

function prep() {
  // if this file execs... assume we're on deno.
  if (!Deno) throw new Error("failed loading deno-specific config");

  const isProd = Deno.env.get("DENO_ENV_DOMAIN") === "production";
  const onDenoDeploy = Deno.env.get("CLOUD_PLATFORM") === "deno-deploy";
  const profiling = Deno.env.get("PROFILE_DNS_RESOLVES") === "true";

  globalThis.envManager = new EnvManager();

  globalThis.log = new Log({
    level: globalThis.envManager.get("LOG_LEVEL") as LogLevels,
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

  // docs.deno.com/runtime/tutorials/os_signals
  Deno.addSignalListener("SIGINT", () => {
    stopAfter();
  });

  // signal all system are-a go
  system.pub("go");
}
