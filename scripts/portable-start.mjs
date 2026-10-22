import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

// Resolve relative to this file, including when launched from another folder.
process.chdir(join(dirname(fileURLToPath(import.meta.url)), ".."));

async function availablePort() {
  for (let port = 3766; port < 3786; port++) {
    const socket = createServer();
    const available = await new Promise((resolve, reject) => {
      socket.once("error", error => error.code === "EADDRINUSE" ? resolve(false) : reject(error));
      socket.listen(port, "127.0.0.1", () => socket.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error("Ports 3766-3785 are busy. Close another R6 StratShare window and try again.");
}

try {
  // Never inherit a public host, proxy trust setting or an installed Node config.
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  process.env.HOST = "127.0.0.1";
  process.env.PORT = String(port);
  process.env.R6_SITE_URL = origin;
  delete process.env.VINEXT_TRUSTED_HOSTS;
  process.argv[2] = "start";
  await import("./selfhost.mjs");

  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`${origin}/api/account`, { signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.json()).signedIn === false) { ready = true; break; }
    } catch {}
    await delay(200);
  }
  if (!ready) throw new Error("The local server could not start. See the messages above.");
  console.log(`\nR6 StratShare is ready: ${origin}`);
  console.log("Keep this window open while using the app. Press Ctrl+C to stop.");
  console.log("Save your strats as JSON files before closing the app.\n");
  if (process.env.R6_PORTABLE_NO_BROWSER !== "1") {
    const browser = spawn("cmd.exe", ["/d", "/c", "start", "", origin], { stdio: "ignore", windowsHide: true });
    browser.on("error", () => console.log(`Open this address in your browser: ${origin}`));
    browser.on("close", code => { if (code) console.log(`Open this address in your browser: ${origin}`); });
  }
} catch (error) {
  console.error(`\nR6 StratShare: ${error.message}`);
  process.exit(1);
}
