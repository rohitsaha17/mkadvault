// Client-side sanitiser for values about to cross a Server Action
// boundary. React Server Components' Flight transport does NOT support
// `NaN` (nor `Infinity`, `-Infinity`, or `-0` in some cases) — sending
// one yields an HTML 500 page and the user sees Next.js' cryptic
// "An unexpected response was received from the server." message.
//
// Typical trigger: react-hook-form's `valueAsNumber: true` turns a
// cleared HTML number input into `NaN`. The Zod resolver preprocesses
// this at validation time, but `getValues()` (used by drafts / partial
// saves) returns the raw internal state and bypasses that filter. RHF's
// internal object can also carry Proxy traps and non-plain descriptors
// that confuse Flight's reflection.
//
// Strategy: hand-recurse normalising NaN/Infinity → undefined,
// stripping functions, Symbols, Maps, Sets and BigInts, and preserving
// plain objects/arrays/dates/strings/booleans/null/undefined. We avoid
// `JSON.stringify` because JSON converts `undefined` → omitted keys and
// can't round-trip Dates, but the user-facing forms in this app only
// produce plain scalars + arrays + nested objects anyway, so a
// hand-rolled walker is safer and faster.

type Scalar = string | number | boolean | null | undefined;
type Json = Scalar | Date | Json[] | { [key: string]: Json };

function scrub(v: unknown, seen: WeakSet<object>): unknown {
  // Fast paths for primitives.
  if (v === null || v === undefined) return v;
  const t = typeof v;
  if (t === "string" || t === "boolean") return v;
  if (t === "number") return Number.isFinite(v as number) ? v : undefined;
  if (t === "bigint") {
    // Flight doesn't support BigInt; fall back to Number when safe.
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  // Functions, symbols: drop them — they aren't serialisable.
  if (t === "function" || t === "symbol") return undefined;
  // Preserve Dates as-is; Flight handles them natively.
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v;
  // Maps / Sets: flatten to arrays.
  if (v instanceof Map) return scrub(Array.from(v.entries()), seen);
  if (v instanceof Set) return scrub(Array.from(v.values()), seen);
  // Anything with a custom toJSON (e.g. Dayjs instances) — let it self-serialise.
  if (
    t === "object" &&
    typeof (v as { toJSON?: () => unknown }).toJSON === "function"
  ) {
    try {
      return scrub((v as { toJSON: () => unknown }).toJSON(), seen);
    } catch {
      return undefined;
    }
  }
  // Guard against cycles.
  if (t === "object") {
    if (seen.has(v as object)) return undefined;
    seen.add(v as object);
  }
  if (Array.isArray(v)) return v.map((x) => scrub(x, seen));
  if (t === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const cleaned = scrub(val, seen);
      // Drop undefined so server-side zod schemas see a missing key
      // rather than a present-but-undefined one (which some schemas
      // treat differently from optional).
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return v;
}

export function sanitizeForTransport<T>(value: T): T {
  return scrub(value, new WeakSet()) as T;
}

// Typed re-export for call sites that want the exhaustive type.
export type { Json };
