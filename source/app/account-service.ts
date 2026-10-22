import { and, eq, ne } from "drizzle-orm";
import { getChatGPTUser } from "./chatgpt-auth";
import {
  flattenErrorMessage,
  getDb,
  isDbBindingUnavailable,
  isMissingTableError,
} from "../db";
import { users } from "../db/schema";

export type Account = { id: string; username: string };

export type AccountState =
  | { signedIn: false; account: null }
  | { signedIn: true; account: Account | null };

export type AccountErrorCode =
  | "UNAUTHENTICATED"
  | "INVALID_USERNAME"
  | "USERNAME_TAKEN"
  | "ACCOUNT_EXISTS"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_STORAGE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export class AccountError extends Error {
  readonly code: AccountErrorCode;

  constructor(code: AccountErrorCode, message: string) {
    super(message);
    this.name = "AccountError";
    this.code = code;
  }
}

// Usernames are trimmed and lowercased before validation/storage, so the
// database unique constraint on `username` enforces case-insensitive
// uniqueness. Allowed: a-z, 0-9, underscore; 3-24 characters.
const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;

const INVALID_USERNAME_MESSAGE =
  "Username must be 3-24 characters using only a-z, 0-9, and underscore.";
const STORAGE_UNAVAILABLE_MESSAGE = "Account storage is unavailable right now.";

export function normalizeUsername(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const username = input.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) return null;
  return username;
}

function toAccount(row: { id: string; username: string }): Account {
  return { id: row.id, username: row.username };
}

// Opens the database or throws ACCOUNT_STORAGE_UNAVAILABLE when the D1
// binding is missing.
function dbOrFail() {
  try {
    return getDb();
  } catch (error) {
    if (isDbBindingUnavailable(error)) {
      throw new AccountError("ACCOUNT_STORAGE_UNAVAILABLE", STORAGE_UNAVAILABLE_MESSAGE);
    }
    throw error;
  }
}

// Re-throws storage-layer failures (missing binding or missing table) as
// ACCOUNT_STORAGE_UNAVAILABLE, and anything else unchanged.
function rethrowStorageError(error: unknown): never {
  if (isDbBindingUnavailable(error) || isMissingTableError(error)) {
    throw new AccountError("ACCOUNT_STORAGE_UNAVAILABLE", STORAGE_UNAVAILABLE_MESSAGE);
  }
  throw error;
}

// A unique-constraint failure names the offending index/column (e.g.
// "UNIQUE constraint failed: users.username"). Returning that column lets the
// caller tell a duplicate-username race apart from a duplicate-identity race.
function uniqueViolationColumn(error: unknown): string | null {
  const text = flattenErrorMessage(error);
  if (!/unique constraint failed/i.test(text)) return null;
  const match = /unique constraint failed:\s*([^\s;]+)/i.exec(text);
  return match ? match[1].toLowerCase() : null;
}

// Maps a unique-constraint race to the correct account error. Falls back to
// USERNAME_TAKEN when the column cannot be identified.
function throwUniqueViolation(error: unknown): never {
  const column = uniqueViolationColumn(error) ?? "";
  if (column.includes("chatgpt_user_id")) {
    // Same platform identity tried to create twice concurrently.
    throw new AccountError("ACCOUNT_EXISTS", "This account already has a username.");
  }
  throw new AccountError("USERNAME_TAKEN", "That username is already taken.");
}

// Resolves a create race by re-reading state instead of trusting the driver
// message. When the same identity and the same username collide at once,
// SQLite reports only one of the violated constraints and which one is not
// deterministic — so the column name alone cannot decide. Looking up whether
// the winning row belongs to this identity gives a stable ACCOUNT_EXISTS, and
// otherwise a USERNAME_TAKEN.
async function resolveCreateRace(
  chatgptUserId: string
): Promise<never> {
  try {
    const db = dbOrFail();
    const winner = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.chatgptUserId, chatgptUserId))
      .limit(1);
    if (winner.length > 0) {
      throw new AccountError(
        "ACCOUNT_EXISTS",
        "This account already has a username."
      );
    }
  } catch (error) {
    if (error instanceof AccountError) throw error;
    rethrowStorageError(error);
  }
  throw new AccountError("USERNAME_TAKEN", "That username is already taken.");
}

// Trust basis: identity comes only from the platform-injected ChatGPT auth
// headers via `getChatGPTUser`, which requires both the user id and email
// headers to be present. The username a client sends is treated purely as a
// display name and never as an identity claim.
async function requireChatGPTUserId(): Promise<string> {
  const user = await getChatGPTUser();
  if (!user) {
    throw new AccountError(
      "UNAUTHENTICATED",
      "Sign in with ChatGPT is required."
    );
  }
  return user.userId;
}

async function currentChatGPTUserId(): Promise<string | null> {
  const user = await getChatGPTUser();
  return user ? user.userId : null;
}

async function findAccountByChatGPTUserId(
  chatgptUserId: string
): Promise<Account | null> {
  const db = dbOrFail();
  try {
    const rows = await db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.chatgptUserId, chatgptUserId))
      .limit(1);
    const row = rows[0];
    return row ? toAccount(row) : null;
  } catch (error) {
    rethrowStorageError(error);
  }
}

async function isUsernameTaken(
  username: string,
  excludeId?: string
): Promise<boolean> {
  const db = dbOrFail();
  try {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(
        excludeId
          ? and(eq(users.username, username), ne(users.id, excludeId))
          : eq(users.username, username)
      )
      .limit(1);
    return rows.length > 0;
  } catch (error) {
    rethrowStorageError(error);
  }
}

export async function getAccountState(): Promise<AccountState> {
  const chatgptUserId = await currentChatGPTUserId();
  if (!chatgptUserId) return { signedIn: false, account: null };

  const account = await findAccountByChatGPTUserId(chatgptUserId);
  return { signedIn: true, account };
}

export async function createAccount(input: {
  username: unknown;
}): Promise<Account> {
  const chatgptUserId = await requireChatGPTUserId();
  const username = normalizeUsername(input.username);
  if (!username) {
    throw new AccountError("INVALID_USERNAME", INVALID_USERNAME_MESSAGE);
  }

  const existing = await findAccountByChatGPTUserId(chatgptUserId);
  if (existing) {
    throw new AccountError(
      "ACCOUNT_EXISTS",
      "This account already has a username."
    );
  }

  if (await isUsernameTaken(username)) {
    throw new AccountError("USERNAME_TAKEN", "That username is already taken.");
  }

  const db = dbOrFail();
  const now = new Date().toISOString();
  try {
    const rows = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        chatgptUserId,
        username,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: users.id, username: users.username });
    const row = rows[0];
    if (!row) {
      throw new AccountError("INTERNAL_ERROR", "Insert returned no row.");
    }
    return toAccount(row);
  } catch (error) {
    if (error instanceof AccountError) throw error;
    // Race: a concurrent insert won the unique constraint. Resolve by state so
    // the same-identity case reports ACCOUNT_EXISTS, not USERNAME_TAKEN.
    if (uniqueViolationColumn(error)) {
      await resolveCreateRace(chatgptUserId);
    }
    rethrowStorageError(error);
  }
}

export async function updateAccountUsername(input: {
  username: unknown;
}): Promise<Account> {
  const chatgptUserId = await requireChatGPTUserId();
  const username = normalizeUsername(input.username);
  if (!username) {
    throw new AccountError("INVALID_USERNAME", INVALID_USERNAME_MESSAGE);
  }

  const existing = await findAccountByChatGPTUserId(chatgptUserId);
  if (!existing) {
    throw new AccountError(
      "ACCOUNT_NOT_FOUND",
      "No username is set for this account yet."
    );
  }

  // Allow re-submitting the current username as a no-op. The account `id` is
  // never touched here, so it stays stable across renames.
  if (existing.username !== username) {
    if (await isUsernameTaken(username, existing.id)) {
      throw new AccountError(
        "USERNAME_TAKEN",
        "That username is already taken."
      );
    }

    const db = dbOrFail();
    try {
      await db
        .update(users)
        .set({ username, updatedAt: new Date().toISOString() })
        .where(eq(users.id, existing.id));
    } catch (error) {
      if (error instanceof AccountError) throw error;
      if (uniqueViolationColumn(error)) {
        throwUniqueViolation(error);
      }
      rethrowStorageError(error);
    }
  }

  return { id: existing.id, username };
}
