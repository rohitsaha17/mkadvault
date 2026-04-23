// Shared Zod helpers for form validation.
//
// These coerce the values that HTML number inputs produce when users
// clear them (empty string, NaN from react-hook-form's valueAsNumber)
// into `undefined` so `z.number().optional()` actually accepts them.
// Without this, Zod v4 rejects NaN as "Expected number, received nan"
// and the form silently blocks the user on otherwise-nullable fields.
import { z } from "zod";

function coerceMaybeNumber(v: unknown) {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "number" && Number.isNaN(v)) return undefined;
  return v;
}

export const optionalNumber = z.preprocess(
  coerceMaybeNumber,
  z.number().optional(),
);

export const optionalPositiveNumber = z.preprocess(
  coerceMaybeNumber,
  z.number().positive("Must be positive").optional(),
);

export const optionalNonNegativeNumber = z.preprocess(
  coerceMaybeNumber,
  z.number().min(0, "Must be 0 or more").optional(),
);

/** Optional percentage in [0, 100]. */
export const optionalPercentage = z.preprocess(
  coerceMaybeNumber,
  z.number().min(0, "Must be 0 or more").max(100, "Cannot exceed 100%").optional(),
);
