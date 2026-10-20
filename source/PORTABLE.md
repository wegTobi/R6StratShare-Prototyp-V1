# Portable Windows package

The portable edition runs the current editor and viewer offline on Windows
10/11 x64. It includes Node.js, a prebuilt selfhost build, every public asset
and the necessary runtime modules. The recipient extracts the entire ZIP and
double-clicks `START.cmd`; no installation or command line setup is required.
Keep its console open while using the app and press Ctrl+C to stop it.
The launcher binds only to `127.0.0.1`, opens the browser once the server is
ready and uses ports 3766–3785 if the preferred port is already occupied.

Use **Save** to export strats as JSON files and load them in the editor or
**View Strat**. Account and cloud storage are disabled by the existing
selfhost build. Save work before closing. Browser preferences belong to
the local origin; use JSON files for durable storage and sharing.

To create a new ZIP on the development machine, use Windows x64 Node.js 24
and the existing installed, locked dependencies. Obtain the official Node.js
`LICENSE` matching `node --version` and save it as
`work/portable-support/NODE-LICENSE.txt`, then run:

```powershell
node scripts/selfhost.mjs build
node --test tests/selfhost.test.mjs
node scripts/package-portable.mjs
```

Output: `outputs/R6-StratShare-Windows.zip`. The destination folder must not
already exist; pass a different output folder as the first argument to create
another release without overwriting files. The optional second argument is
the path to the Node license. The package contains source code in `source/`;
all original public assets are stored once in `dist/client/`.
Private environment files, databases, tokens, Git history, local browser
state and developer caches are not included.

To verify an extracted package, run `node --test tests/portable.test.mjs`
with `R6_PORTABLE_DIR` set to its absolute directory. This checks the bundled
executable, loopback binding, port fallback, HTTP assets and integrity hashes.
The existing `tests/browser/selfhost-smoke.js` can also be run against the
printed address for editor-to-viewer JSON round-trip verification.

Packaging does not change the hosted app or publish anything. Both build
targets use `dist/`; run the original `pnpm run build` before a Sites deployment.
