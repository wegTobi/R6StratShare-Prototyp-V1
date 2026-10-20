import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import test, { before, after } from "node:test";

let child, base;
let output = "";
before(async () => {
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["scripts/selfhost.mjs", "start"], {
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", R6_SITE_URL: "https://strats.example.com" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", chunk => { output = (output + chunk).slice(-12000); });
  child.stderr.on("data", chunk => { output = (output + chunk).slice(-12000); });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(output);
    try { if ((await fetch(`${base}/api/account`)).ok) return; } catch {}
    await delay(200);
  }
  throw new Error(`Node server did not become ready: ${output}`);
}, { timeout: 30000 });
after(async () => {
  if (!child || child.exitCode !== null) return;
  const closed = new Promise(resolve => child.once("close", resolve));
  child.kill("SIGTERM");
  await closed;
});

test("Node production server renders the app with the public metadata origin and no active sign-in", async () => {
  const response = await fetch(base);
  assert.equal(response.status, 200);
  const html = await response.text();
  for (const label of ["Strat Editor", "View Strat", "Coming soon"]) assert.ok(html.includes(label), label);
  assert.match(html, /https:\/\/strats\.example\.com\/og\.png/);
  assert.doesNotMatch(html, /href="\/signin-with-chatgpt/);
  const script = html.match(/import\("([^"\s]+\.js)"\)/);
  assert.ok(script, "client script must be included");
  const asset = await fetch(new URL(script[1], base));
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("content-type"), /javascript/);
  const fonts = [...html.matchAll(/url\(([^)]+\.woff2)\)/g)].map(match => match[1]);
  assert.ok(fonts.length > 0, "self-hosted fonts must be included");
  for (const font of new Set(fonts)) {
    assert.match(font, /^\/assets\/_vinext_fonts\//);
    assert.equal((await fetch(base + font)).status, 200, font);
  }
});

test("Node serves representative public assets byte for byte", async () => {
  for (const path of ["/og.png", "/favicon.svg", "/operators/operator-icons-sheet.png", "/operators/icons/noor.png", "/map-mod-icons/map-mods-sheet.png", "/icons/eraser-streamline-solar.svg"]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(new URL(`../public${path}`, import.meta.url)), path);
  }
});

test("selfhost ignores forged identity and refuses all account mutations without a database", async () => {
  const headers = { "oai-authenticated-user-id": "forged", "oai-authenticated-user-email": "forged@example.com", "content-type": "application/json" };
  const response = await fetch(base + "/api/account", { headers });
  assert.deepEqual(await response.json(), { signedIn: false, account: null });
  assert.equal(response.headers.get("cache-control"), "no-store");
  for (const method of ["POST", "PATCH"]) {
    const result = await fetch(base + "/api/account", { method, headers, body: JSON.stringify({ username: "forged" }) });
    assert.equal(result.status, 503);
    assert.equal((await result.json()).error.code, "ACCOUNT_STORAGE_UNAVAILABLE");
  }
  const forwarded = await fetch(base + "/api/account", { headers: { ...headers, "x-forwarded-host": "strats.example.com", "x-forwarded-proto": "https" } });
  assert.equal(forwarded.status, 200);
  assert.deepEqual(await forwarded.json(), { signedIn: false, account: null });
});

test("selfhost build contains no unresolved Cloudflare runtime imports", async () => {
  const source = await readFile(new URL("../dist/server/index.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /(?:from\s*|import\s*\()\s*["']cloudflare:/);
});
