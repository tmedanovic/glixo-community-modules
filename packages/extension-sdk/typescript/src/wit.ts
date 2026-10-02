import type { Result } from "./http.js";

/** Return a bounded string payload for a WIT `result<_, string>` error arm. */
export function witErrorText(error: unknown): string {
  const text = typeof error === "string" ? error : error instanceof Error ? error.message : "guest_error";
  return text.slice(0, 256) || "guest_error";
}

/** Convert a generated Jco import that throws on WIT `err` into an SDK Result. */
export function captureWitResult<T>(operation: () => T): Result<T> {
  try { return { ok: true, value: operation() }; }
  catch (error) { return { ok: false, error: witErrorText(error) }; }
}

/** Return `err<string>` from a generated Jco export. Throw a primitive string. */
export function throwWitError(error: unknown): never {
  throw witErrorText(error);
}
