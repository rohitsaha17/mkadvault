// Client-side sanitiser for values about to cross a Server Action
// boundary. React Server Components' Flight transport does NOT support
// `NaN` (nor `Infinity`) — sending one yields an HTML 500 page and the
// user sees Next.js' cryptic "An unexpected response was received from
// the server." message.
//
// Typical trigger: react-hook-form's `valueAsNumber: true` turns a
// cleared HTML number input into `NaN`. The Zod resolver preprocesses
// this at validation time, but `getValues()` (used by drafts / partial
// saves) returns the raw internal state and bypasses that filter.
//
// Call `sanitizeForTransport(values)` right before any Server Action
// call that might carry user-entered number fields.

type Sanitizable =
  | string
  | number
  | boolean
  | null
  | undefined
  | Date
  | Sanitizable[]
  | { [key: string]: Sanitizable };

function scrub(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (Array.isArray(v)) return v.map(scrub);
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = scrub(val);
    }
    return out;
  }
  return v;
}

export function sanitizeForTransport<T>(value: T): T {
  return scrub(value) as T;
}

// Typed re-export for call sites that want the exhaustive type.
export type { Sanitizable };
