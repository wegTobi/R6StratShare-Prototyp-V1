import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const bundleHash = async () => createHash("sha256").update(await readFile("dist/server/index.js")).digest("hex");

const command = process.argv[2];
process.env.R6_DEPLOY_TARGET = "selfhost";
process.env.NODE_ENV = "production";

if (command === "build") {
  const cli = fileURLToPath(new URL("./cli.js", import.meta.resolve("vinext")));
  const child = spawn(process.execPath, [cli, "build"], { stdio: "inherit", env: process.env });
  child.on("error", (error) => { console.error(error); process.exitCode = 1; });
  child.on("close", async (code) => {
    process.exitCode = code ?? 1;
    if (code === 0) {
      try { await writeFile("dist/selfhost.json", JSON.stringify({ accounts: false, bundleHash: await bundleHash() })); }
      catch (error) { console.error(error); process.exitCode = 1; }
    }
  });
} else if (command === "start") {
  const marker = JSON.parse(await readFile("dist/selfhost.json", "utf8"));
  if (marker.accounts !== false || marker.bundleHash !== await bundleHash()) throw new Error("Run build:selfhost before start:selfhost.");
  if (process.env.R6_SITE_URL) {
    const url = new URL(process.env.R6_SITE_URL);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("R6_SITE_URL must be an HTTP(S) origin without credentials, path, query or fragment.");
    }
    // Only the named origin is trusted; the container is reachable via the
    // tunnel network, with no published host port.
    process.env.VINEXT_TRUSTED_HOSTS = url.host;
  }
  const { startProdServer, tryServeStatic } = await import("vinext/server/prod-server");
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535.");
  const { server } = await startProdServer({ port, host: process.env.HOST || "0.0.0.0" });
  if (process.platform === "win32") {
    // Vinext 0.0.50's static cache uses Windows separators as URL keys.
    // Its uncached public API handles paths correctly. Linux uses the normal
    // cached production server unchanged.
    const [handler] = server.listeners("request");
    server.removeListener("request", handler);
    server.on("request", async (request, response) => {
      try {
        const pathname = new URL(request.url, "http://localhost").pathname;
        if (["GET", "HEAD"].includes(request.method) && await tryServeStatic(request, response, "dist/client", pathname, true)) return;
        handler(request, response);
      } catch {
        if (!response.headersSent) response.writeHead(500);
        response.end("Internal Server Error");
      }
    });
  }
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10000).unref();
    });
  }
} else {
  throw new Error("Usage: node scripts/selfhost.mjs build|start");
}
