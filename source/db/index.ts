import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

export function flattenErrorMessage(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;

  while (current) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }

  return parts.join(" ");
}

export function isDbBindingUnavailable(error: unknown): boolean {
  return /D1 binding `DB` is unavailable|binding.*DB.*unavailable/i.test(
    flattenErrorMessage(error)
  );
}

export function isMissingTableError(error: unknown): boolean {
  return /no such table|table .* does not exist/i.test(flattenErrorMessage(error));
}
