import { config as dotEnvConfig } from "dotenv";

// Load env variables from .env file to Deno.env (if file exists)
try {
  dotEnvConfig({ export: true });
  Deno.env.set("RUNTIME_ENV", "deno");
} catch (e) {
  // throws without --allow-read flag
  console.warn(".env file may not be loaded => ", e.name, ":", e.message);
}
