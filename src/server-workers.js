import * as system from "./system.js";
import "./helpers/workers/config.js";
import { handleRequest } from "./index.js";

(main => {
  system.sub("go", systemUp)
})();

function systemUp() {
  if (typeof addEventListener === "undefined") {
    throw new Error("workers env missing addEventListener");
  }
  addEventListener("fetch", (event) => {
    event.respondWith(handleRequest(event));
  });
}

