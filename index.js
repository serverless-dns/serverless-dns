import CurrentRequest from "./currentRequest.js";
import RethinkPlugin from "./plugin.js";
import Env from "./env.js";
import { BlocklistWrapper } from "@serverless-dns/blocklist-wrapper";

if (typeof addEventListener !== "undefined") {
  addEventListener("fetch", (event) => {
    event.respondWith(handleRequest(event));
  });
}

export function handleRequest(event) {
  return proxyRequest(event);
}

const blocklistFilter = new BlocklistWrapper();
const env = new Env();
async function proxyRequest(event) {
  const currentRequest = new CurrentRequest();
  let res;
  try {
    if (event.request.method === "OPTIONS") {
      res = new Response();
      res.headers.set("Content-Type", "application/json");
      res.headers.set("Access-Control-Allow-Origin", "*");
      res.headers.set("Access-Control-Allow-Headers", "*");
      return res;
    }

    if (!env.isLoaded) {
      env.loadEnv();
    }
    if (
      blocklistFilter.isBlocklistUnderConstruction == false &&
      blocklistFilter.isBlocklistLoaded == false
    ) {
      await blocklistFilter.initBlocklistConstruction(
        env.get("runTimeEnv"),
        env.get("blocklistUrl"),
        env.get("latestTimestamp"),
      );
    }

    let retryCount = 0;
    const retryLimit = 150;
    while (blocklistFilter.isBlocklistUnderConstruction == true) {
      if (retryCount >= retryLimit) {
        break;
      }
      await sleep(50);
      if (blocklistFilter.isBlocklistLoadException == true) {
        break;
      }
      retryCount++;
    }

    if (blocklistFilter.isBlocklistLoaded == true) {
      const plugin = new RethinkPlugin(blocklistFilter, event, env);
      await plugin.executePlugin(currentRequest);
    } else if (blocklistFilter.isException == true) {
      currentRequest.stopProcessing = true;
      currentRequest.isException = true;
      currentRequest.exceptionStack = blocklistFilter.exceptionStack;
      currentRequest.exceptionFrom = blocklistFilter.exceptionFrom;
      currentRequest.dnsExceptionResponse();
    } else {
      currentRequest.stopProcessing = true;
      currentRequest.exceptionFrom = "Blocklist Not yet loaded";
      currentRequest.customResponse({
        errorFrom: "index.js proxyRequest",
        errorReason: "Problem in loading blocklistFilter - Waiting Timeout",
      });
    }

    return currentRequest.httpResponse;
  } catch (e) {
    console.error(e.stack);
    res = new Response(JSON.stringify(e.stack));
    res.headers.set("Content-Type", "application/json");
    res.headers.set("Access-Control-Allow-Origin", "*");
    res.headers.set("Access-Control-Allow-Headers", "*");
    res.headers.append("Vary", "Origin");
    res.headers.delete("expect-ct");
    res.headers.delete("cf-ray");
    return res;
  }
}

const sleep = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};
