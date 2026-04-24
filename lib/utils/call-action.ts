// Client-side wrapper around POST /api/action. Every user-facing
// form/button that used to `import { someAction }` from a Server
// Action file should now call
//     const result = await callAction("someAction", arg1, arg2);
// instead. This routes through the stable dispatcher URL so a stale
// client bundle can NEVER hit a stale action hash and trigger
//   "An unexpected response was received from the server."
//
// Args are forwarded positionally — whatever signature the action
// has on the server. `sanitizeForTransport` is applied automatically
// to each arg so NaN / Infinity / other non-Flight-safe values get
// stripped before hitting the network.

import { sanitizeForTransport } from "@/lib/utils/sanitize";

export async function callAction<T = unknown>(
  name: string,
  ...args: unknown[]
): Promise<T & { error?: string }> {
  // Sanitize every argument individually. Actions typically take
  // either a single values object or (id, values) — both patterns
  // are handled naturally by mapping over the array.
  const cleanArgs = args.map((a) => sanitizeForTransport(a));

  let res: Response;
  try {
    res = await fetch("/api/action", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, args: cleanArgs }),
    });
  } catch (err) {
    return {
      error: err instanceof Error ? `Network error: ${err.message}` : "Network error",
    } as T & { error?: string };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return {
      error: `Unexpected server response (HTTP ${res.status})`,
    } as T & { error?: string };
  }

  // The dispatcher returns whatever shape the action returned, so
  // the caller's type check (e.g. `"error" in result`) still works.
  return (data ?? {}) as T & { error?: string };
}
