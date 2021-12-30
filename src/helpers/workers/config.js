import EnvManager from "../env.js";
import * as system from "../../system.js";
import Log from "../log.js";

(main => {

  // if we're executing this file, we're on workers
  globalThis.RUNTIME = "worker";

  const isProd = globalThis.WORKER_ENV === "production";

  if (!globalThis.envManager) {
    globalThis.envManager = new EnvManager();
  }

  globalThis.log = new Log(
    env.logLevel,
    isProd // set console level only in prod.
  );

  system.pub("ready");
})();
