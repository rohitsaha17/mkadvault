// Date-range presets used by filter dropdowns across the app.
// Indian fiscal year: Apr 1 → Mar 31. Quarters within the FY:
//   Q1 Apr–Jun · Q2 Jul–Sep · Q3 Oct–Dec · Q4 Jan–Mar
// "Current FY" is the FY that contains today.

export type DateRangePreset =
  | "all"
  | "current_fy"
  | "last_fy"
  | "current_quarter"
  | "last_quarter"
  | "this_month"
  | "last_month"
  | "last_30_days"
  | "next_30_days";

/** Human-readable labels for the filter dropdown. */
export const DATE_RANGE_LABELS: Record<DateRangePreset, string> = {
  all: "All time",
  current_fy: "Current FY",
  last_fy: "Last FY",
  current_quarter: "Current quarter",
  last_quarter: "Last quarter",
  this_month: "This month",
  last_month: "Last month",
  last_30_days: "Last 30 days",
  next_30_days: "Next 30 days",
};

/** Ordered list for rendering the select options. */
export const DATE_RANGE_ORDER: DateRangePreset[] = [
  "all",
  "current_fy",
  "last_fy",
  "current_quarter",
  "last_quarter",
  "this_month",
  "last_month",
  "last_30_days",
  "next_30_days",
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

    case "next_30_days": {
      const to = new Date(today);
      to.setDate(to.getDate() + 30);
      return { from: iso(today), to: iso(to) };
    }
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
