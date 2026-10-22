import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Build this package using Windows x64 Node.js.");
const output = resolve(process.argv[2] || "outputs/R6-StratShare-Windows");
const nodeLicense = resolve(process.argv[3] || "work/portable-support/NODE-LICENSE.txt");
const license = await readFile(nodeLicense, "utf8");
if (!license.includes("Node.js") || !license.includes("Permission")) throw new Error("Supply the official LICENSE for the bundled Node version.");
const marker = JSON.parse(await readFile("dist/selfhost.json", "utf8"));
const hash = createHash("sha256").update(await readFile("dist/server/index.js")).digest("hex");
if (marker.accounts !== false || marker.bundleHash !== hash) throw new Error("Run node scripts/selfhost.mjs build first.");
// A fresh destination prevents stale files or accidental inclusion of secrets.
await mkdir(dirname(output), { recursive: true });
await mkdir(output, { recursive: false });
await cp("dist", join(output, "dist"), { recursive: true });
await mkdir(join(output, "runtime"));
await cp(process.execPath, join(output, "runtime/node.exe"));
await writeFile(join(output, "runtime/NODE-LICENSE.txt"), license);
await mkdir(join(output, "scripts"));
for (const file of ["selfhost.mjs", "portable-start.mjs"]) await cp(join("scripts", file), join(output, "scripts", file));
await writeFile(join(output, "package.json"), JSON.stringify({ name: "r6-stratshare-portable", private: true, type: "module" }, null, 2));

// Dereference pnpm's links into ordinary folders: ZIP extraction needs no symlink support.
const require = createRequire(import.meta.url);
const packages = new Set();
async function copyPackage(name, from) {
  if (packages.has(name)) return;
  packages.add(name);
  const packageFile = from.resolve(`${name}/package.json`);
  const directory = dirname(packageFile);
  const manifest = JSON.parse(await readFile(packageFile, "utf8"));
  await cp(directory, join(output, "node_modules", name), {
    recursive: true, dereference: true,
    filter: source => source === directory || !source.slice(directory.length + 1).split(/[\\/]/).includes("node_modules"),
  });
  for (const dependency of Object.keys(manifest.dependencies || {})) await copyPackage(dependency, createRequire(packageFile));
}
await copyPackage("react", require);
await copyPackage("react-dom", require);
// The production-server import graph only uses Node built-ins and Vinext internals.
const vinext = dirname(dirname(fileURLToPath(import.meta.resolve("vinext"))));
for (const file of ["dist", "LICENSE", "package.json"]) await cp(join(vinext, file), join(output, "node_modules/vinext", file), { recursive: true });

// Keep editable project sources too, without private env files, local state or credentials.
const source = join(output, "source");
await mkdir(source);
for (const directory of ["app", "build", "db", "drizzle", "examples", "worker", "scripts", "tests"]) {
  await cp(directory, join(source, directory), { recursive: true });
}
for (const file of ["AGENTS.md", "README.md", "SELFHOSTING.md", "PORTABLE.md", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "vite.config.ts", "next.config.ts", "tsconfig.json", "postcss.config.mjs", "eslint.config.mjs", "drizzle.config.ts", "Dockerfile", "compose.yaml", "selfhost.env.example", ".dockerignore", ".gitignore"]) {
  await cp(file, join(source, file));
}
await cp(".openai/hosting.json", join(source, ".openai/hosting.json"));
await writeFile(join(source, "ASSETS.txt"), "All original public/ assets are included in ../dist/client/. To develop this source snapshot, copy the non-generated assets from there into source/public/. The portable app already has everything it needs.\n");
await writeFile(join(output, "START.cmd"), [
  "@echo off", "setlocal", "title R6 StratShare - Local", 'cd /d "%~dp0"',
  "set NODE_OPTIONS=", "set NODE_PATH=", "set NODE_ENV=production",
  'if not exist "runtime\\node.exe" goto missing',
  '"%~dp0runtime\\node.exe" "%~dp0scripts\\portable-start.mjs"',
  "if errorlevel 1 pause", "exit /b", ":missing",
  "echo Extract the entire ZIP first, then run START.cmd from the extracted folder.", "pause", "exit /b 1", "",
].join("\r\n"));
await writeFile(join(output, "README-FIRST.txt"), [
  "R6 StratShare - Portable for Windows 10/11 (64-bit)", "",
  "1. Extract the ENTIRE ZIP to a normal folder. Do not run it inside the ZIP.",
  "2. Double-click START.cmd. The app opens in your default browser.",
  "3. Keep the console window open. Press Ctrl+C there to stop the app.", "",
  "No installation, administrator access, Docker or internet connection is needed.",
  "The included Node.js runtime starts a server accessible only on this computer.",
  "If the browser does not open, use the address printed in the console.", "",
  "CREATE: Strat Editor > Start Editor. Save exports a JSON file.",
  "VIEW: View Strat > paste/load your saved strat JSON.",
  "Save your work as JSON before closing. Account/cloud saving is unavailable.",
  "Send the JSON files to friends to share strats. Closing a browser tab does not stop the server.", "",
  "All maps, operator assets, fonts and application files are included.",
  "source/ contains the project sources; public assets live in dist/client/ to avoid duplication.",
  "Third-party licenses are included with the runtime and its packages.", "",
].join("\r\n"));
await cp("docs/portable-readme-de.txt", join(output, "LIESMICH.txt"));
await cp("docs/portable-readme-de.txt", join(source, "docs/portable-readme-de.txt"));
const files = [];
async function inventory(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) await inventory(join(directory, entry.name), relative + "/");
    else files.push({ path: relative, sha256: createHash("sha256").update(await readFile(join(directory, entry.name))).digest("hex") });
  }
}
await inventory(output);
await writeFile(join(output, "manifest.json"), JSON.stringify({ renderer: "artwork-v2", builtAt: new Date().toISOString(), bundleHash: hash, node: process.version, platform: "win32-x64", files }, null, 2));
const zip = `${output}.zip`;
const result = spawnSync("tar.exe", ["-a", "-cf", zip, "-C", dirname(output), output.slice(dirname(output).length + 1)], { stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`ZIP creation failed: ${result.status}`);
console.log(`Portable ZIP: ${zip}`);
