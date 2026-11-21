// Date-range presets used by filter dropdowns across the app.
// Indian fiscal year: Apr 1 → Mar 31. Quarters within the FY:
//   Q1 Apr–Jun · Q2 Jul–Sep · Q3 Oct–Dec · Q4 Jan–Mar
// "Current FY" is the FY that contains today.

export type DateRangePreset =
  | "all"
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "current_quarter"
  | "last_quarter"
  | "current_fy"
  | "last_fy"
  | "last_30_days"
  | "last_90_days"
  | "next_30_days"
  | "ytd"
  | "custom";

/** Human-readable labels for the filter dropdown. */
export const DATE_RANGE_LABELS: Record<DateRangePreset, string> = {
  all: "All time",
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This week",
  last_week: "Last week",
  this_month: "This month",
  last_month: "Last month",
  current_quarter: "This quarter",
  last_quarter: "Last quarter",
  current_fy: "This financial year",
  last_fy: "Last financial year",
  last_30_days: "Last 30 days",
  last_90_days: "Last 90 days",
  next_30_days: "Next 30 days",
  ytd: "Year to date",
  custom: "Custom range",
};

/** Ordered list for rendering the select options. */
export const DATE_RANGE_ORDER: DateRangePreset[] = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "current_quarter",
  "last_quarter",
  "current_fy",
  "last_fy",
  "ytd",
  "last_30_days",
  "last_90_days",
  "next_30_days",
  "all",
  "custom",
];

function iso(d: Date): string {
  // YYYY-MM-DD in local time — DB dates are date-only so TZ doesn't matter.
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Resolve a preset to concrete [from, to] inclusive ISO dates.
 * Returns null for "all" so the caller skips the filter entirely.
 */
export function resolveDateRange(
  preset: DateRangePreset,
  today: Date = new Date(),
): { from: string; to: string } | null {
  const y = today.getFullYear();
  const m = today.getMonth(); // 0-indexed

  // Current FY start year — Jan/Feb/Mar (months 0/1/2) belong to the FY
  // that started the PREVIOUS calendar year.
  const fyStartYear = m < 3 ? y - 1 : y;

  switch (preset) {
    case "all":
      return null;

    case "current_fy":
      return {
        from: iso(new Date(fyStartYear, 3, 1)), // Apr 1
        to: iso(new Date(fyStartYear + 1, 2, 31)), // Mar 31
      };

    case "last_fy":
      return {
        from: iso(new Date(fyStartYear - 1, 3, 1)),
        to: iso(new Date(fyStartYear, 2, 31)),
      };

    case "current_quarter": {
      // Map calendar month to Indian-FY quarter (Q1 Apr-Jun, Q2 Jul-Sep, etc.)
      const { qStartMonth, qYear } = quarterBounds(y, m, fyStartYear);
      return {
        from: iso(new Date(qYear, qStartMonth, 1)),
        to: iso(endOfMonth(qYear, qStartMonth + 2)),
      };
    }

    case "last_quarter": {
      const { qStartMonth, qYear } = quarterBounds(y, m, fyStartYear);
      // Subtract 3 months from the current quarter start.
      const prevStart = new Date(qYear, qStartMonth - 3, 1);
      return {
        from: iso(prevStart),
        to: iso(endOfMonth(prevStart.getFullYear(), prevStart.getMonth() + 2)),
      };
    }

    case "this_month":
      return {
        from: iso(new Date(y, m, 1)),
        to: iso(endOfMonth(y, m)),
      };

    case "last_month":
      return {
        from: iso(new Date(y, m - 1, 1)),
        to: iso(endOfMonth(y, m - 1)),
      };

    case "last_30_days": {
      const from = new Date(today);
      from.setDate(from.getDate() - 30);
      return { from: iso(from), to: iso(today) };
    }

    case "last_90_days": {
      const from = new Date(today);
      from.setDate(from.getDate() - 90);
      return { from: iso(from), to: iso(today) };
    }

    case "next_30_days": {
      const to = new Date(today);
      to.setDate(to.getDate() + 30);
      return { from: iso(today), to: iso(to) };
    }

    case "today":
      return { from: iso(today), to: iso(today) };

    case "yesterday": {
      const d = new Date(today);
      d.setDate(d.getDate() - 1);
      return { from: iso(d), to: iso(d) };
    }

    case "this_week": {
      // ISO week: Monday start. Adjust so Sunday (day 0) maps to -6.
      const d = new Date(today);
      const dow = d.getDay(); // 0 (Sun) .. 6 (Sat)
      const offset = dow === 0 ? -6 : 1 - dow;
      const monday = new Date(d);
      monday.setDate(d.getDate() + offset);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { from: iso(monday), to: iso(sunday) };
    }

    case "last_week": {
      const d = new Date(today);
      const dow = d.getDay();
      const offset = dow === 0 ? -6 : 1 - dow;
      const thisMon = new Date(d);
      thisMon.setDate(d.getDate() + offset);
      const lastMon = new Date(thisMon);
      lastMon.setDate(thisMon.getDate() - 7);
      const lastSun = new Date(lastMon);
      lastSun.setDate(lastMon.getDate() + 6);
      return { from: iso(lastMon), to: iso(lastSun) };
    }

    case "ytd":
      return { from: iso(new Date(y, 0, 1)), to: iso(today) };

    case "custom":
      // Custom ranges are resolved from URL `from`/`to` params by the caller.
      // Returning null lets the caller detect "need explicit dates".
      return null;
  }
}

/** Returns the first month (0-indexed) of the Indian-FY quarter that
 *  contains `m` in calendar year `y`, plus the calendar year in which
 *  that quarter starts. Q4 starts in January of the NEXT calendar year
 *  relative to the FY start. */
function quarterBounds(
  y: number,
  m: number,
  fyStartYear: number,
): { qStartMonth: number; qYear: number } {
  // Quarter boundaries in calendar-month terms:
  //   Q1: Apr (3) .. Jun (5)  → starts month 3 of fyStartYear
  //   Q2: Jul (6) .. Sep (8)  → starts month 6 of fyStartYear
  //   Q3: Oct (9) .. Dec (11) → starts month 9 of fyStartYear
  //   Q4: Jan (0) .. Mar (2)  → starts month 0 of fyStartYear+1
  if (m >= 3 && m <= 5) return { qStartMonth: 3, qYear: fyStartYear };
  if (m >= 6 && m <= 8) return { qStartMonth: 6, qYear: fyStartYear };
  if (m >= 9 && m <= 11) return { qStartMonth: 9, qYear: fyStartYear };
  return { qStartMonth: 0, qYear: y };
}

function endOfMonth(y: number, m: number): Date {
  // Day 0 of next month is the last day of current month.
  return new Date(y, m + 1, 0);
}

/** Short human description of a resolved range — used to show below the
 *  filter so the user knows exactly what dates they're filtering on. */
export function describeDateRange(from: string, to: string): string {
  const fmt = (iso: string): string => {
    const [y, m, d] = iso.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };
  return `${fmt(from)} – ${fmt(to)}`;
}

/**
 * Resolve either a preset OR an explicit custom range from URL params
 * into concrete [from, to] inclusive ISO date strings.
 *
 * - preset: one of DateRangePreset (default "current_fy")
 * - from/to: only used when preset === "custom" (or preset unset but
 *   explicit dates were given — we honour them in either case).
 * - Falls back to current FY on missing/invalid inputs so the dashboard
 *   never renders without a range.
 */
export function resolveDashboardRange(input: {
  preset?: string;
  from?: string;
  to?: string;
  today?: Date;
}): { preset: DateRangePreset; from: string; to: string } {
  const today = input.today ?? new Date();

  // Validate preset against the known set — anything else is treated as
  // the default (current FY).
  const presetCandidates: DateRangePreset[] = [...DATE_RANGE_ORDER];
  const preset: DateRangePreset =
    input.preset && presetCandidates.includes(input.preset as DateRangePreset)
      ? (input.preset as DateRangePreset)
      : "current_fy";

  // ISO regex — YYYY-MM-DD only. Anything else is ignored.
  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
  const explicitFrom = input.from && isoRe.test(input.from) ? input.from : undefined;
  const explicitTo = input.to && isoRe.test(input.to) ? input.to : undefined;

  if (preset === "custom") {
    // Custom: require both; if missing, fall back to current FY.
    if (explicitFrom && explicitTo && explicitFrom <= explicitTo) {
      return { preset: "custom", from: explicitFrom, to: explicitTo };
    }
    const fy = resolveDateRange("current_fy", today)!;
    return { preset: "current_fy", ...fy };
  }

  if (preset === "all") {
    // "All time" — use a very wide synthetic range so callers that always
    // apply a range filter still work. Earliest OOH data isn't before 2020
    // in practice; 10 years ahead covers forward bookings.
    return {
      preset: "all",
      from: iso(new Date(today.getFullYear() - 10, 0, 1)),
      to: iso(new Date(today.getFullYear() + 10, 11, 31)),
    };
  }

  const resolved = resolveDateRange(preset, today);
  if (!resolved) {
    const fy = resolveDateRange("current_fy", today)!;
    return { preset: "current_fy", ...fy };
  }
  return { preset, ...resolved };
}

/**
 * Pro-rate a booking value against a range using date overlap.
 *
 * Given a booking that runs [bookingFrom..bookingTo] worth valuePaise,
 * returns the share that falls inside [rangeFrom..rangeTo], inclusive of
 * both endpoints on both sides.
 *
 *   overlap_days / total_days * valuePaise
 *
 * Returns 0 if there is no overlap. All dates are ISO YYYY-MM-DD strings
 * so timezone drift can't move a boundary by a day.
 */
export function prorateByRange(
  bookingFrom: string | null | undefined,
  bookingTo: string | null | undefined,
  valuePaise: number,
  rangeFrom: string,
  rangeTo: string,
): number {
  if (!bookingFrom || !bookingTo || !valuePaise) return 0;

  // Treat each ISO string as a UTC midnight to avoid DST / TZ drift.
  const bf = Date.parse(bookingFrom + "T00:00:00Z");
  const bt = Date.parse(bookingTo + "T00:00:00Z");
  const rf = Date.parse(rangeFrom + "T00:00:00Z");
  const rt = Date.parse(rangeTo + "T00:00:00Z");

  if (!Number.isFinite(bf) || !Number.isFinite(bt)) return 0;
  if (bt < bf) return 0; // Malformed booking.

  // Overlap: max(starts), min(ends).
  const overlapStart = Math.max(bf, rf);
  const overlapEnd = Math.min(bt, rt);
  if (overlapEnd < overlapStart) return 0;

  const MS_PER_DAY = 86_400_000;
  const totalDays = Math.floor((bt - bf) / MS_PER_DAY) + 1;
  const overlapDays = Math.floor((overlapEnd - overlapStart) / MS_PER_DAY) + 1;

  if (totalDays <= 0) return 0;
  return Math.round((valuePaise * overlapDays) / totalDays);
}

/** Number of days between two ISO date strings, inclusive of both ends. */
export function daysInRange(from: string, to: string): number {
  const f = Date.parse(from + "T00:00:00Z");
  const t = Date.parse(to + "T00:00:00Z");
  if (!Number.isFinite(f) || !Number.isFinite(t) || t < f) return 0;
  return Math.floor((t - f) / 86_400_000) + 1;
}
