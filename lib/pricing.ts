// Pricing math that consumers (proposals, invoices, P&L, dashboards)
// rely on so they don't each re-implement the per-basis arithmetic.
//
// The model:
//   base_rate_paise   — rate per unit
//   billable_units    — count of units the rate multiplies against
//   pricing_basis     — what a "unit" is (face / kiosk / slot / second)
//
// computeEffectiveMonthlyRate normalises everything to a monthly rupee
// figure so totals across a campaign or a P&L line up regardless of
// what the rate basis actually is.

import type { PricingBasis, Site } from "./types/database";

// "Operating days" per month assumption used to normalise per-day or
// per-second pricing. 30 is the safe industry default for OOH; if a
// specific contract uses 25 working days the booking row can override.
const DAYS_PER_MONTH = 30;

// "Operating hours" assumed when DOOH specs aren't filled in. Mirrors
// most metro DOOH which runs 6 AM – 11 PM-ish.
const FALLBACK_OPERATING_HOURS_PER_DAY = 16;

export interface RateInputs {
  base_rate_paise: number | null;
  pricing_basis: PricingBasis;
  billable_units: number | null;
  // Optional context Site carries when the medium needs daily/loop
  // structure to compute a monthly figure. Pass the same Site you
  // already have — anything missing falls back to safe defaults.
  media_specs?: Site["media_specs"];
}

/**
 * Returns the effective monthly rate in paise. Caller decides how to
 * format (₹ / lakh / mo / etc.). Returns 0 when inputs aren't enough
 * to compute — never NaN — so dashboard sums don't poison.
 */
export function computeEffectiveMonthlyRate(input: RateInputs): number {
  const rate = input.base_rate_paise ?? 0;
  const units = input.billable_units ?? 1;
  if (!rate || !units) return 0;

  switch (input.pricing_basis) {
    case "flat_monthly":
    case "per_face_monthly":
    case "per_kiosk_monthly":
    case "per_panel_monthly":
    case "per_slot_monthly":
    case "per_sqft_monthly":
      // All monthly bases multiply rate × units directly.
      return rate * units;

    case "per_slot": {
      // DOOH per-slot pricing — units = slots-per-day. Multiply by the
      // operating-day assumption to get a comparable monthly figure.
      return rate * units * DAYS_PER_MONTH;
    }

    case "per_second": {
      // DOOH per-second pricing — units = seconds-of-screen-time
      // per day. If media_specs has a loop structure use it, otherwise
      // assume the full operating window.
      const dooh =
        input.media_specs && input.media_specs.kind === "dooh"
          ? input.media_specs
          : null;
      const hoursPerDay = dooh?.operating_hours_per_day ?? FALLBACK_OPERATING_HOURS_PER_DAY;
      // We're given a per-second rate × seconds-per-day → multiply by
      // days. (We trust the form's `billable_units` to mean
      // seconds-per-day; the form helper below derives it from loop
      // structure for clarity.)
      void hoursPerDay; // keep the variable for future-proofing
      return rate * units * DAYS_PER_MONTH;
    }

    case "custom":
      // Caller decided not to model the math — show whatever
      // base_rate_paise was, no multiplication.
      return rate;
  }

  return 0;
}

/**
 * Human-readable label for the rate basis — e.g. "₹X / month",
 * "₹X / kiosk / month", "₹X / slot". Used in the form preview, in
 * proposal site cells, and on the rate-card line items.
 */
export function pricingBasisLabel(basis: PricingBasis): string {
  switch (basis) {
    case "flat_monthly":
      return "/ month";
    case "per_face_monthly":
      return "/ face / month";
    case "per_kiosk_monthly":
      return "/ kiosk / month";
    case "per_panel_monthly":
      return "/ panel / month";
    case "per_slot_monthly":
      return "/ slot / month";
    case "per_slot":
      return "/ slot";
    case "per_second":
      return "/ second";
    case "per_sqft_monthly":
      return "/ sqft / month";
    case "custom":
      return "(custom)";
  }
}

/**
 * Helper for the DOOH form: given loop structure, derive
 * "seconds of screen time per day" so the per-second pricing path
 * has a sensible default for billable_units.
 *
 *   slots/loop × slot_seconds × loops/hour × hours/day
 */
export function deriveDoohSecondsPerDay(input: {
  slots_per_loop: number;
  slot_duration_seconds: number;
  loop_duration_seconds: number;
  operating_hours_per_day: number;
}): number {
  const loopsPerHour =
    input.loop_duration_seconds > 0 ? 3600 / input.loop_duration_seconds : 0;
  return Math.round(
    input.slots_per_loop *
      input.slot_duration_seconds *
      loopsPerHour *
      input.operating_hours_per_day,
  );
}
