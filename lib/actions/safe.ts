// Safe-action utilities.
//
// The single most common production bug in this codebase has been:
//
//   "An unexpected response was received from the server."
//
// That string is Next.js' RSC runtime telling you a Server Action returned
// HTML (an error page) instead of the expected JSON/RSC payload. The cause
// is always the same: a Server Action threw an uncaught error. Common
// culprits in this app are the Supabase auth admin SDK (it throws on 5xx
// instead of returning `{ error }`), storage uploads on flaky networks,
// and Postgres RLS/constraint failures that surface as thrown exceptions.
//
// Every exported Server Action in the app MUST either:
//   a) wrap its body in a top-level try/catch and return `{ error }`, or
//   b) be wrapped with `safeAction(...)` below.
//
// `redirect()` and `notFound()` from Next work by throwing a tagged error
// (identified by `.digest`). We MUST re-throw those or navigation breaks.

/** Was this thrown by Next's redirect() / notFound() helper? */
export function isNextInternalThrow(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const digest = (err as { digest?: unknown }).digest;
  if (typeof digest !== "string") return false;
  return (
    digest.startsWith("NEXT_REDIRECT") ||
    digest.startsWith("NEXT_NOT_FOUND") ||
    digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")
  );
}

/** Convert an unknown thrown value into a `{ error: string }` result. */
export function toActionError(err: unknown, context?: string): { error: string } {
  // Log so it's visible in Vercel logs / dev console.
  if (context) {
    console.error(`[server-action:${context}] unhandled error:`, err);
  } else {
    console.error("[server-action] unhandled error:", err);
  }
  if (err instanceof Error) {
    // Most Postgres/Supabase errors already have a useful .message. Keep it
    // short — the UI will toast this verbatim.
    return { error: err.message };
  }
  return { error: "Unexpected server error. Please try again." };
}

/**
 * Higher-order wrapper that converts any thrown error into a JSON
 * `{ error }` result. Re-throws Next.js redirect / notFound internals so
 * navigation continues to work.
 *
 * Usage:
 *   export const createThing = safeAction(async (input) => {
 *     // body — may throw freely, it'll be caught
 *     return { success: true };
 *   }, "createThing");
 */
export function safeAction<A extends unknown[], R extends object>(
  fn: (...args: A) => Promise<R>,
  context?: string,
): (...args: A) => Promise<R | { error: string }> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (isNextInternalThrow(err)) throw err;
      return toActionError(err, context);
    }
  };
}
