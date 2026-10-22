import {
  AccountError,
  createAccount,
  getAccountState,
  updateAccountUsername,
  type AccountErrorCode,
} from "../../account-service";
import { isSelfHosted } from "../../deployment";

export const dynamic = "force-dynamic";

const ERROR_STATUS: Record<AccountErrorCode, number> = {
  UNAUTHENTICATED: 401,
  INVALID_USERNAME: 400,
  USERNAME_TAKEN: 409,
  ACCOUNT_EXISTS: 409,
  ACCOUNT_NOT_FOUND: 404,
  ACCOUNT_STORAGE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

// Account responses carry identity state and must never be cached by shared
// caches or the browser. `Vary: Origin` keeps responses keyed per-origin.
const NO_STORE_HEADERS: Record<string, string> = {
  "cache-control": "no-store",
  vary: "Origin",
};

// State-changing methods must not be reachable cross-site. Browsers attach the
// platform auth headers automatically, so a cross-origin write would otherwise
// ride an existing session. A missing Origin header (same-origin GET, server
// callers) is allowed; a present-but-different Origin is rejected.
//
// The comparison uses the full `URL.origin` (scheme + host + port), not just
// the host: an attacker page served over plain http on the same host must not
// be accepted for an https request. `URL.origin` also normalizes casing and
// default ports, so https://Example.com:443 equals https://example.com.
function isCrossOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  // Absent Origin: not sent by a browser cross-site form/fetch -> allow.
  if (!origin) return false;
  // Opaque origin (sandboxed frame, data:/file: context) -> reject.
  if (origin === "null") return true;

  const requestOrigin = safeOrigin(request.url);
  const headerOrigin = safeOrigin(origin);
  if (requestOrigin === null || headerOrigin === null) return true;

  return headerOrigin !== requestOrigin;
}

// Returns the normalized origin, or null when the URL cannot be parsed or does
// not resolve to an http(s) origin (URL.origin is the string "null" then).
function safeOrigin(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  const origin = parsed.origin;
  return origin === "null" ? null : origin;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...NO_STORE_HEADERS },
  });
}

function originRejected(): Response {
  return json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Cross-origin account requests are not allowed.",
      },
    },
    403
  );
}

export async function GET() {
  if (isSelfHosted) return json({ signedIn: false, account: null });
  try {
    const state = await getAccountState();
    return json(state);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (isSelfHosted) return accountsDisabled();
  if (isCrossOrigin(request)) return originRejected();
  try {
    const body = await readJsonBody(request);
    const account = await createAccount({ username: body.username });
    return json({ signedIn: true, account }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  if (isSelfHosted) return accountsDisabled();
  if (isCrossOrigin(request)) return originRejected();
  try {
    const body = await readJsonBody(request);
    const account = await updateAccountUsername({ username: body.username });
    return json({ signedIn: true, account }, 200);
  } catch (error) {
    return errorResponse(error);
  }
}

function accountsDisabled(): Response {
  return json({ error: { code: "ACCOUNT_STORAGE_UNAVAILABLE", message: "Accounts are not available on this server yet." } }, 503);
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const data = await request.json();
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
  } catch {
    // Fall through to an empty body so validation reports INVALID_USERNAME.
  }
  return {};
}

function errorResponse(error: unknown): Response {
  if (error instanceof AccountError) {
    return json(
      { error: { code: error.code, message: error.message } },
      ERROR_STATUS[error.code] ?? 500
    );
  }

  console.error("[account] unexpected error:", error);
  return json(
    { error: { code: "INTERNAL_ERROR", message: "Unexpected server error." } },
    500
  );
}
