import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { register } from "node:module";
import test from "node:test";

// The built server bundle imports `cloudflare:workers` as a bare specifier to
// read bindings (`env.DB`). That specifier only exists inside workerd, so we
// register a loader hook that points it at a stub backed by `globalThis`. The
// stub re-exports the same object we mutate from the tests, letting us toggle
// the D1 binding on and off without a real deployment.
const STUB_URL =
  "data:text/javascript," +
  encodeURIComponent("export const env = globalThis.__WORKERS_ENV__;");

const LOADER_SOURCE = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return { url: ${JSON.stringify(STUB_URL)}, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`;

register(
  "data:text/javascript," + encodeURIComponent(LOADER_SOURCE),
  import.meta.url,
);

// Must exist before the account route chunk (which imports the stub) is first
// evaluated. We always mutate this same object.
globalThis.__WORKERS_ENV__ = {};

// ---------------------------------------------------------------------------
// Minimal D1 shim backed by an in-memory SQLite database. drizzle-orm's d1
// driver only uses prepare(sql).bind(...params) and then run()/all()/raw(),
// so we implement exactly that surface with node:sqlite.
// ---------------------------------------------------------------------------
function createFakeD1({ failure = null } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE users (
      id text PRIMARY KEY NOT NULL,
      chatgpt_user_id text NOT NULL,
      username text NOT NULL,
      created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
      updated_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
    );
    CREATE UNIQUE INDEX users_chatgpt_user_id_unique ON users (chatgpt_user_id);
    CREATE UNIQUE INDEX users_username_unique ON users (username);
  `);

  // Emulate a nested driver error (D1 wraps the real cause). Used to prove the
  // backend surfaces missing-table failures as 503, not 500.
  function maybeFail() {
    if (failure === "missing-table-nested") {
      const cause = new Error("no such table: users");
      throw new Error("D1_ERROR: request failed", { cause });
    }
  }

  function makeStatement(sql, params = []) {
    return {
      bind(...nextParams) {
        return makeStatement(sql, nextParams);
      },
      async run() {
        maybeFail();
        const info = db.prepare(sql).run(...params);
        return { success: true, meta: info };
      },
      async all() {
        maybeFail();
        const rows = db.prepare(sql).all(...params);
        return { results: rows, success: true };
      },
      async raw() {
        maybeFail();
        const rows = db.prepare(sql).all(...params);
        return rows.map((row) => Object.values(row));
      },
    };
  }

  return {
    prepare(sql) {
      return makeStatement(sql);
    },
    __reset() {
      db.exec("DELETE FROM users;");
    },
  };
}

const fakeD1 = createFakeD1();
const brokenD1 = createFakeD1({ failure: "missing-table-nested" });
globalThis.__WORKERS_ENV__.DB = fakeD1;

// ---------------------------------------------------------------------------
// Drive the built worker exactly like rendered-html.test.mjs does.
// ---------------------------------------------------------------------------
const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);

const CTX = {
  waitUntil() {},
  passThroughOnException() {},
};
const ASSETS = {
  fetch: async () => new Response("Not found", { status: 404 }),
};

function authHeaders(userId, email = "user@example.com") {
  if (!userId) return {};
  return {
    "oai-authenticated-user-id": userId,
    "oai-authenticated-user-email": email,
  };
}

async function callAccount({
  method = "GET",
  headers = {},
  body,
  origin,
  url = "http://localhost/api/account",
} = {}) {
  const request = new Request(url, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(origin !== undefined ? { origin } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const response = await worker.fetch(request, { ASSETS }, CTX);
  return {
    status: response.status,
    body: await response.json(),
    cacheControl: response.headers.get("cache-control"),
  };
}

test.beforeEach(() => {
  globalThis.__WORKERS_ENV__.DB = fakeD1;
  fakeD1.__reset();
});

// ---------------------------------------------------------------------------
// GET contract
// ---------------------------------------------------------------------------
test("GET is anonymous when no auth headers are present", async () => {
  globalThis.__WORKERS_ENV__.DB = null; // must not matter for anonymous GET
  const { status, body } = await callAccount();
  assert.equal(status, 200);
  assert.deepEqual(body, { signedIn: false, account: null });
});

test("GET treats a lone user-id header as anonymous (trust basis)", async () => {
  // Identity requires BOTH id and email headers; a partial set is not trusted.
  const { status, body } = await callAccount({
    headers: { "oai-authenticated-user-id": "user-1" },
  });
  assert.equal(status, 200);
  assert.deepEqual(body, { signedIn: false, account: null });
});

test("GET treats an email-only header set as anonymous (trust basis)", async () => {
  const { status, body } = await callAccount({
    headers: { "oai-authenticated-user-email": "user@example.com" },
  });
  assert.equal(status, 200);
  assert.deepEqual(body, { signedIn: false, account: null });
});

test("GET returns signedIn with a null account before a profile exists", async () => {
  const { status, body } = await callAccount({ headers: authHeaders("user-1") });
  assert.equal(status, 200);
  assert.deepEqual(body, { signedIn: true, account: null });
});

test("GET returns the stored account for a signed-in user", async () => {
  await callAccount({
    method: "POST",
    headers: authHeaders("user-1"),
    body: { username: "Ghost_R6" },
  });
  const { status, body } = await callAccount({ headers: authHeaders("user-1") });
  assert.equal(status, 200);
  assert.equal(body.signedIn, true);
  assert.equal(body.account.username, "ghost_r6");
  assert.equal(typeof body.account.id, "string");
});

// ---------------------------------------------------------------------------
// POST contract
// ---------------------------------------------------------------------------
test("POST rejects anonymous callers with UNAUTHENTICATED", async () => {
  const { status, body } = await callAccount({
    method: "POST",
    body: { username: "ghost_r6" },
  });
  assert.equal(status, 401);
  assert.equal(body.error.code, "UNAUTHENTICATED");
  assert.equal(typeof body.error.message, "string");
});

test("POST rejects invalid usernames with INVALID_USERNAME", async () => {
  const invalid = ["ab", "a".repeat(25), "ghost r6", "ghost-r6", 42, null];
  for (const username of invalid) {
    const { status, body } = await callAccount({
      method: "POST",
      headers: authHeaders("user-1"),
      body: { username },
    });
    assert.equal(status, 400, `expected 400 for ${JSON.stringify(username)}`);
    assert.equal(body.error.code, "INVALID_USERNAME");
  }
});

test("POST trims, lowercases, and stores a valid username", async () => {
  const { status, body } = await callAccount({
    method: "POST",
    headers: authHeaders("user-1"),
    body: { username: "  Ghost_R6  " },
  });
  assert.equal(status, 201);
  assert.deepEqual(body, {
    signedIn: true,
    account: { id: body.account.id, username: "ghost_r6" },
  });
});

test("POST returns ACCOUNT_EXISTS when the user already has a profile", async () => {
  await callAccount({
    method: "POST",
    headers: authHeaders("user-1"),
    body: { username: "ghost_r6" },
  });
  const { status, body } = await callAccount({
    method: "POST",
    headers: authHeaders("user-1"),
    body: { username: "another_name" },
  });
  assert.equal(status, 409);
  assert.equal(body.error.code, "ACCOUNT_EXISTS");
});

test("POST returns USERNAME_TAKEN when the handle belongs to another user", async () => {
  await callAccount({
    method: "POST",
    headers: authHeaders("user-1"),
    body: { username: "ghost_r6" },
  });
  const { status, body } = await callAccount({
    method: "POST",
    headers: authHeaders("user-2"),
    body: { username: "Ghost_R6" }, // same handle, different case
  });
  assert.equal(status, 409);
  assert.equal(body.error.code, "USERNAME_TAKEN");
});

// ---------------------------------------------------------------------------
// PATCH contract
// ---------------------------------------------------------------------------
test("PATCH rejects anonymous callers with UNAUTHENTICATED", async () => {
  const { status, body } = await callAccount({
    method: "PATCH",
    body: { username: "ghost_r6" },
  });
  assert.equal(status, 401);
  assert.equal(body.error.code, "UNAUTHENTICATED");
});

test("PATCH returns ACCOUNT_NOT_FOUND when no profile exists", async () => {
  const { status, body } = await callAccount({
    method: "PATCH",
    headers: authHeaders("user-1"),
    body: { username: "ghost_r6" },
  });
  assert.equal(status, 404);
  assert.equal(body.error.code, "ACCOUNT_NOT_FOUND");
});

test("PATCH updates the username and keeps the account id stable", async () => {
  const created = await callAccount({
    method: "POST",
    headers: authHeaders("user-1"),
    body: { username: "ghost_r6" },
  });
  const originalId = created.body.account.id;

  const { status, body } = await callAccount({
    method: "PATCH",
    headers: authHeaders("user-1"),
    body: { username: "  NEW_Ghost  " },
  });
  assert.equal(status, 200);
  assert.deepEqual(body, {
    signedIn: true,
    account: { id: originalId, username: "new_ghost" },
  });
  // Rename must never change the stable identity key.
  assert.equal(body.account.id, originalId);
});

test("PATCH allows re-submitting the current username as a no-op", async () => {
  await callAccount({
    method: "POST",
    headers: authHeaders("user-1"),
    body: { username: "ghost_r6" },
  });
  const { status, body } = await callAccount({
    method: "PATCH",
    headers: authHeaders("user-1"),
    body: { username: "ghost_r6" },
  });
  assert.equal(status, 200);
  assert.equal(body.account.username, "ghost_r6");
});

test("PATCH returns USERNAME_TAKEN when moving to another user's handle", async () => {
  await callAccount({
    method: "POST",
    headers: authHeaders("user-1"),
    body: { username: "ghost_r6" },
  });
  await callAccount({
    method: "POST",
    headers: authHeaders("user-2"),
    body: { username: "smoke_main" },
  });
  const { status, body } = await callAccount({
    method: "PATCH",
    headers: authHeaders("user-1"),
    body: { username: "smoke_main" },
  });
  assert.equal(status, 409);
  assert.equal(body.error.code, "USERNAME_TAKEN");
});

// ---------------------------------------------------------------------------
// Missing D1 binding must surface as 503, not 500.
// ---------------------------------------------------------------------------
test("signed-in GET returns 503 ACCOUNT_STORAGE_UNAVAILABLE without a D1 binding", async () => {
  globalThis.__WORKERS_ENV__.DB = null;
  const { status, body } = await callAccount({ headers: authHeaders("user-1") });
  assert.equal(status, 503);
  assert.equal(body.error.code, "ACCOUNT_STORAGE_UNAVAILABLE");
});

test("POST returns 503 ACCOUNT_STORAGE_UNAVAILABLE without a D1 binding", async () => {
  globalThis.__WORKERS_ENV__.DB = null;
  const { status, body } = await callAccount({
    method: "POST",
    headers: authHeaders("user-1"),
    body: { username: "ghost_r6" },
  });
  assert.equal(status, 503);
  assert.equal(body.error.code, "ACCOUNT_STORAGE_UNAVAILABLE");
});

test("anonymous requests still succeed without a D1 binding", async () => {
  globalThis.__WORKERS_ENV__.DB = null;
  const { status, body } = await callAccount();
  assert.equal(status, 200);
  assert.deepEqual(body, { signedIn: false, account: null });
});

test("nested missing-table driver error surfaces as 503, not 500", async () => {
  // The error is wrapped in a D1-style `cause` chain; the backend must still
  // classify it as storage-unavailable.
  globalThis.__WORKERS_ENV__.DB = brokenD1;
  const { status, body } = await callAccount({ headers: authHeaders("user-1") });
  assert.equal(status, 503);
  assert.equal(body.error.code, "ACCOUNT_STORAGE_UNAVAILABLE");
});

// ---------------------------------------------------------------------------
// Cache + origin hardening
// ---------------------------------------------------------------------------
test("every account response is marked cache-control: no-store", async () => {
  const anonymous = await callAccount();
  assert.equal(anonymous.cacheControl, "no-store");

  const signedIn = await callAccount({ headers: authHeaders("user-1") });
  assert.equal(signedIn.cacheControl, "no-store");

  const created = await callAccount({
    method: "POST",
    headers: authHeaders("user-1"),
    body: { username: "ghost_r6" },
  });
  assert.equal(created.cacheControl, "no-store");

  const error = await callAccount({ method: "POST", body: {} });
  assert.equal(error.cacheControl, "no-store");
});

test("POST rejects a cross-origin request with 403", async () => {
  const { status } = await callAccount({
    method: "POST",
    headers: authHeaders("user-1"),
    body: { username: "ghost_r6" },
    origin: "https://evil.example",
  });
  assert.equal(status, 403);
});

test("PATCH rejects a cross-origin request with 403", async () => {
  const { status } = await callAccount({
    method: "PATCH",
    headers: authHeaders("user-1"),
    body: { username: "ghost_r6" },
    origin: "https://evil.example",
  });
  assert.equal(status, 403);
});

test("POST allows a same-origin request", async () => {
  const { status } = await callAccount({
    method: "POST",
    headers: authHeaders("user-1"),
    body: { username: "ghost_r6" },
    origin: "http://localhost",
  });
  assert.equal(status, 201);
});

// An origin is scheme + host + port. Matching the host alone is not enough: a
// page served over plain http must never be accepted for the https site.
test("POST rejects the same host over a different scheme", async () => {
  const { status, body } = await callAccount({
    method: "POST",
    headers: authHeaders("user-1"),
    body: { username: "ghost_r6" },
    origin: "https://localhost", // request is http://localhost
  });
  assert.equal(status, 403);
  assert.equal(body.error.code, "INTERNAL_ERROR");
});

test("PATCH rejects the same host over a different scheme", async () => {
  const { status } = await callAccount({
    method: "PATCH",
    headers: authHeaders("user-1"),
    body: { username: "ghost_r6" },
    origin: "https://localhost", // request is http://localhost
  });
  assert.equal(status, 403);
});

test("POST rejects the same host on a different port", async () => {
  const { status } = await callAccount({
    method: "POST",
    headers: authHeaders("user-1"),
    body: { username: "ghost_r6" },
    origin: "http://localhost:8080", // request is http://localhost
  });
  assert.equal(status, 403);
});

test("POST allows a same origin that spells out the default port", async () => {
  // http://localhost:80 normalizes to http://localhost, so it is same-origin.
  const { status } = await callAccount({
    method: "POST",
    headers: authHeaders("user-1"),
    body: { username: "ghost_r6" },
    origin: "http://localhost",
    url: "http://localhost:80/api/account",
  });
  assert.equal(status, 201);
});

// ---------------------------------------------------------------------------
// Concurrent profile creation (races)
// ---------------------------------------------------------------------------
test("concurrent create for the same identity yields one success and ACCOUNT_EXISTS", async () => {
  const results = await Promise.all([
    callAccount({
      method: "POST",
      headers: authHeaders("user-1"),
      body: { username: "ghost_r6" },
    }),
    callAccount({
      method: "POST",
      headers: authHeaders("user-1"),
      body: { username: "ghost_r6" },
    }),
  ]);

  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 409]);
  const failed = results.find((r) => r.status === 409);
  assert.equal(failed.body.error.code, "ACCOUNT_EXISTS");
});

test("concurrent create for the same username yields one success and USERNAME_TAKEN", async () => {
  const results = await Promise.all([
    callAccount({
      method: "POST",
      headers: authHeaders("user-1"),
      body: { username: "ghost_r6" },
    }),
    callAccount({
      method: "POST",
      headers: authHeaders("user-2"),
      body: { username: "ghost_r6" },
    }),
  ]);

  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 409]);
  const failed = results.find((r) => r.status === 409);
  assert.equal(failed.body.error.code, "USERNAME_TAKEN");
});

// ---------------------------------------------------------------------------
// The real Drizzle migration, applied to a fresh SQLite database.
// ---------------------------------------------------------------------------
test("the real 0000 migration creates the users table with enforced uniqueness", () => {
  const sqlText = readFileSync(
    new URL("../drizzle/0000_cooing_grey_gargoyle.sql", import.meta.url),
    "utf8"
  );

  const db = new DatabaseSync(":memory:");
  for (const statement of sqlText.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) db.exec(trimmed);
  }

  // Table and columns exist.
  const columns = db.prepare("PRAGMA table_info(users);").all();
  const names = columns.map((c) => c.name);
  for (const expected of [
    "id",
    "chatgpt_user_id",
    "username",
    "created_at",
    "updated_at",
  ]) {
    assert.ok(names.includes(expected), `missing column ${expected}`);
  }

  // Both unique indexes exist.
  const indexes = db
    .prepare("PRAGMA index_list(users);")
    .all()
    .map((i) => i.name);
  assert.ok(indexes.includes("users_chatgpt_user_id_unique"));
  assert.ok(indexes.includes("users_username_unique"));

  // Timestamp defaults fill in.
  db.prepare(
    "INSERT INTO users (id, chatgpt_user_id, username) VALUES (?, ?, ?)"
  ).run("id-1", "chat-1", "ghost_r6");
  const row = db
    .prepare("SELECT created_at, updated_at FROM users WHERE id = ?")
    .get("id-1");
  assert.ok(row.created_at, "created_at default missing");
  assert.ok(row.updated_at, "updated_at default missing");

  // Duplicate username is rejected by the DB.
  assert.throws(
    () =>
      db
        .prepare("INSERT INTO users (id, chatgpt_user_id, username) VALUES (?, ?, ?)")
        .run("id-2", "chat-2", "ghost_r6"),
    /UNIQUE constraint failed/i
  );

  // Duplicate platform identity is rejected by the DB.
  assert.throws(
    () =>
      db
        .prepare("INSERT INTO users (id, chatgpt_user_id, username) VALUES (?, ?, ?)")
        .run("id-3", "chat-1", "another_name"),
    /UNIQUE constraint failed/i
  );
});
