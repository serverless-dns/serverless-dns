// src/core/node/config-api.js
import fs from "fs";
import http from "http";

const CONFIG_PATH = "/data/config.json";

export function startConfigApi() {
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/configure") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          fs.writeFileSync(CONFIG_PATH, body);
          res.writeHead(200);
          res.end("saved");
        } catch (e) {
          res.writeHead(500);
          res.end(e.message);
        }
      });
    } else if (req.method === "GET" && req.url === "/configure") {
      try {
        const data = fs.readFileSync(CONFIG_PATH, "utf8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end("{}");
      }
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  });

  server.listen(8081, () => console.log("Config API listening on port 8081"));
}
