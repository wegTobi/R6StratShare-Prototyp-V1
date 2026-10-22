/**
 * Browser-side access to the account API.
 *
 * Contract (owned by the account backend, not by this file):
 * - GET /api/account -> { signedIn: false, account: null }
 *                    | { signedIn: true, account: null }
 *                    | { signedIn: true, account: { id, username } }
 * - POST /api/account with { username } creates the profile.
 * - PATCH /api/account with { username } renames the profile.
 * - Both mutations answer with { signedIn: true, account: { id, username } }
 *   or with { error: { code, message } }.
 *
 * Sign-in state and usernames are only ever read from the API. Nothing here
 * stores account data in the browser, and a failed request is surfaced as an
 * error instead of being mistaken for "signed out".
 */

export type AccountProfile = {
  id: string;
  username: string;
};

export type AccountState =
  | { signedIn: false; account: null }
  | { signedIn: true; account: AccountProfile | null };

export type AccountError = {
  code: string;
  message: string;
};

export type AccountUsernameMode = "create" | "update";

export const ACCOUNT_ENDPOINT = "/api/account";
export const CHATGPT_SIGN_IN_PATH = "/signin-with-chatgpt?return_to=%2F";
export const CHATGPT_SIGN_OUT_PATH = "/signout-with-chatgpt?return_to=%2F";

export const usernameMinLength = 3;
export const usernameMaxLength = 24;
export const usernameAllowedPattern = /^[a-z0-9_]+$/;

const USERNAME_RULES_MESSAGE =
  "Use 3-24 characters: a-z, 0-9, and underscores.";
const NETWORK_ERROR_MESSAGE =
  "StratShare could not reach the account service. Check your connection and try again.";
const SERVICE_UNAVAILABLE_MESSAGE =
  "Account services are temporarily unavailable. Try again in a moment.";
const UNEXPECTED_RESPONSE_MESSAGE =
  "StratShare received an unexpected account response. Try again.";

export class AccountRequestError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AccountRequestError";
    this.code = code;
  }
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function isUsernameFormatValid(value: string): boolean {
  const username = normalizeUsername(value);
  return (
    username.length >= usernameMinLength &&
    username.length <= usernameMaxLength &&
    usernameAllowedPattern.test(username)
  );
}

export function getUsernameFormatError(value: string): AccountError | null {
  if (isUsernameFormatValid(value)) return null;
  return { code: "INVALID_USERNAME", message: USERNAME_RULES_MESSAGE };
}

export function toAccountError(value: unknown): AccountError {
  if (value instanceof AccountRequestError) {
    return { code: value.code, message: value.message };
  }

  if (value && typeof value === "object") {
    const candidate = value as { code?: unknown; message?: unknown };
    if (typeof candidate.code === "string" && typeof candidate.message === "string") {
      return { code: candidate.code, message: candidate.message };
    }
  }

  return {
    code: "UNKNOWN_ERROR",
    message: "Something went wrong with your account. Try again.",
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function parseAccountProfile(value: unknown): AccountProfile | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== "string" || typeof record.username !== "string") {
    return null;
  }
  return { id: record.id, username: record.username };
}

function parseAccountState(value: unknown): AccountState | null {
  const record = asRecord(value);
  if (!record || typeof record.signedIn !== "boolean") return null;
  if (!record.signedIn) return { signedIn: false, account: null };
  return { signedIn: true, account: parseAccountProfile(record.account) };
}

function parseApiError(value: unknown): AccountError | null {
  const record = asRecord(value);
  const error = asRecord(record ? record.error : null);
  if (!error || typeof error.code !== "string" || typeof error.message !== "string") {
    return null;
  }
  return { code: error.code, message: error.message };
}

async function requestJson(
  pathname: string,
  init: RequestInit,
): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await fetch(pathname, { credentials: "same-origin", ...init });
  } catch {
    throw new AccountRequestError("NETWORK_ERROR", NETWORK_ERROR_MESSAGE);
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  return { status: response.status, body };
}

function requestFailure(status: number, body: unknown): AccountRequestError {
  if (status === 503) {
    return new AccountRequestError("SERVICE_UNAVAILABLE", SERVICE_UNAVAILABLE_MESSAGE);
  }
  return (
    parseApiError(body) ??
    new AccountRequestError(
      "ACCOUNT_REQUEST_FAILED",
      `The account request failed (${status}). Try again.`,
    )
  );
}

function unexpectedResponse(): AccountRequestError {
  return new AccountRequestError("INVALID_RESPONSE", UNEXPECTED_RESPONSE_MESSAGE);
}

export async function fetchAccountState(): Promise<AccountState> {
  const { status, body } = await requestJson(ACCOUNT_ENDPOINT, {
    method: "GET",
    headers: { accept: "application/json" },
  });

  // 401 means "not signed in": the panel offers Sign in with ChatGPT.
  if (status === 401) return { signedIn: false, account: null };
  if (status < 200 || status >= 300) throw requestFailure(status, body);

  const state = parseAccountState(body);
  if (!state) throw unexpectedResponse();
  return state;
}

export async function saveAccountUsername(
  value: string,
  mode: AccountUsernameMode,
): Promise<AccountState> {
  const { status, body } = await requestJson(ACCOUNT_ENDPOINT, {
    method: mode === "create" ? "POST" : "PATCH",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ username: normalizeUsername(value) }),
  });

  if (status === 401) {
    throw new AccountRequestError("UNAUTHORIZED", "Sign in with ChatGPT to save a username.");
  }
  if (status < 200 || status >= 300) throw requestFailure(status, body);

  const state = parseAccountState(body);
  if (!state || !state.signedIn || !state.account) throw unexpectedResponse();
  return state;
}
