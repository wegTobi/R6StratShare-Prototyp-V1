import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const directory = resolve(process.env.R6_PORTABLE_DIR || "outputs/R6-StratShare-Windows");

test("portable ZIP contains ordinary files, every public asset and matching integrity hashes", async () => {
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  assert.equal(manifest.platform, "win32-x64");
  const paths = new Set(manifest.files.map(file => file.path));
  for (const file of manifest.files) {
    assert.equal(createHash("sha256").update(await readFile(join(directory, file.path))).digest("hex"), file.sha256, file.path);
    assert.doesNotMatch(file.path, /(?:^|\/)(?:\.env[^/]*|secrets|\.git|\.wrangler)(?:\/|$)/);
  }
  async function publicAssets(folder, prefix = "") {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.isDirectory()) await publicAssets(join(folder, entry.name), prefix + entry.name + "/");
      else {
        const path = prefix + entry.name;
        assert.ok(paths.has(`dist/client/${path}`), path);
        assert.deepEqual(await readFile(join(directory, "dist/client", path)), await readFile(join(folder, entry.name)), path);
      }
    }
  }
  await publicAssets("public");
  async function noLinks(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      assert.ok(!entry.isSymbolicLink(), join(folder, entry.name));
      if (entry.isDirectory()) await noLinks(join(folder, entry.name));
    }
  }
  await noLinks(directory);
  assert.ok(paths.has("runtime/NODE-LICENSE.txt"));
  assert.ok(paths.has("START.cmd"));
});

test("START.cmd launches the bundled runtime offline with port fallback and working app assets", { timeout: 40000 }, async () => {
  const blocker = createServer();
  await new Promise((resolve, reject) => {
    blocker.once("error", error => error.code === "EADDRINUSE" ? resolve() : reject(error));
    blocker.listen(3766, "127.0.0.1", resolve);
  });
  const child = spawn("cmd.exe", ["/d", "/c", "START.cmd"], {
    cwd: directory,
    env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "", R6_PORTABLE_NO_BROWSER: "1", HOST: "0.0.0.0", R6_SITE_URL: "https://ignored.invalid", PATH: process.env.SystemRoot + "\\System32" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  try {
    let match;
    for (let attempt = 0; attempt < 150; attempt++) {
      if (child.exitCode !== null) assert.fail(output);
      match = output.match(/R6 StratShare is ready: (http:\/\/127\.0\.0\.1:(\d+))/);
      if (match) break;
      await delay(100);
    }
    assert.ok(match, output);
    assert.ok(Number(match[2]) > 3766, "occupied default port must select a fallback");
    const base = match[1];
    const htmlResponse = await fetch(base);
    assert.equal(htmlResponse.status, 200);
    const html = await htmlResponse.text();
    assert.match(html, /Strat Editor/);
    assert.match(html, /View Strat/);
    assert.match(html, /Coming soon/);
    assert.ok(html.includes(`${base}/og.png`));
    const script = html.match(/import\("([^"\s]+\.js)"\)/);
    assert.ok(script);
    for (const path of [script[1], "/operators/operator-icons-sheet.png", "/map-mod-icons/map-mods-sheet.png", "/operators/icons/noor.png", "/icons/eraser-streamline-solar.svg", ...new Set([...html.matchAll(/url\(([^)]+\.woff2)\)/g)].map(match => match[1]))]) {
      assert.equal((await fetch(new URL(path, base))).status, 200, path);
    }
    const account = await fetch(base + "/api/account");
    assert.deepEqual(await account.json(), { signedIn: false, account: null });
  } finally {
    // Terminate only the process tree created by this test, including the batch wrapper.
    if (child.exitCode === null) {
      const stop = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
      await new Promise(resolve => stop.once("close", resolve));
    }
    if (blocker.listening) await new Promise(resolve => blocker.close(resolve));
  }
});
