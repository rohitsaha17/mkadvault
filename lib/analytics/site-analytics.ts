// Server-side helper that computes KPIs for a single site.
//
// Numbers returned:
//   revenue_paise       — money earned from campaigns that used this site
//                         (sum of campaign_sites.site_rate_paise over the
//                          window). All historical campaigns, including ones
//                          currently live.
//   rent_cost_paise     — money paid to landowner/agency via contract payments
//   expense_cost_paise  — sum of site_expenses marked paid for this site
//   cost_paise          — rent + expenses
//   profit_paise        — revenue − cost
//   margin_pct          — profit / revenue, or null if revenue is 0
//   occupancy_pct       — % of days in the window covered by at least one
//                         active campaign (live / completed / dismounted
//                         count as "booked days")
//   booked_days / total_days
//   campaign_count      — distinct campaigns that booked this site in window
//   pending_expenses_paise — outstanding requests waiting to be paid
//   last_12_months      — monthly revenue + cost buckets for a chart
//
// All money is in paise. The caller is expected to divide by 100 for display.

import { createClient } from "@/lib/supabase/server";

export interface SiteAnalytics {
  revenue_paise: number;
  rent_cost_paise: number;
  expense_cost_paise: number;
  cost_paise: number;
  profit_paise: number;
  margin_pct: number | null;
  occupancy_pct: number;
  booked_days: number;
  total_days: number;
  campaign_count: number;
  pending_expenses_paise: number;
  pending_expense_count: number;
  last_12_months: Array<{
    // "2025-11" style key, first day of month
    month: string;
    revenue_paise: number;
    cost_paise: number;
  }>;
}

export interface SiteAnalyticsOptions {
  // Inclusive window. Defaults to last 365 days from today.
  fromDate?: string; // "YYYY-MM-DD"
  toDate?: string;   // "YYYY-MM-DD"
}

// Produce ISO YYYY-MM-DD from a Date, UTC-safe (no off-by-one from TZ).
function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Inclusive day count between two YYYY-MM-DD strings.
function dayDiffInclusive(a: string, b: string): number {
  const ta = Date.parse(a + "T00:00:00Z");
  const tb = Date.parse(b + "T00:00:00Z");
  return Math.max(0, Math.round((tb - ta) / 86400000) + 1);
}

// Merge overlapping [start,end] intervals and return the total days covered.
function totalCoveredDays(
  intervals: Array<{ start: string; end: string }>,
  windowStart: string,
  windowEnd: string,
): number {
  if (intervals.length === 0) return 0;

  // Clamp each interval to the analytics window then sort by start.
  const clamped = intervals
    .map((i) => ({
      start: i.start < windowStart ? windowStart : i.start,
      end: i.end > windowEnd ? windowEnd : i.end,
    }))
    .filter((i) => i.start <= i.end)
    .sort((a, b) => a.start.localeCompare(b.start));

  let days = 0;
  let curStart = clamped[0].start;
  let curEnd = clamped[0].end;
  for (let i = 1; i < clamped.length; i++) {
    const c = clamped[i];
    if (c.start <= addDay(curEnd, 1)) {
      if (c.end > curEnd) curEnd = c.end;
    } else {
      days += dayDiffInclusive(curStart, curEnd);
      curStart = c.start;
      curEnd = c.end;
    }
  }
  days += dayDiffInclusive(curStart, curEnd);
  return days;
}

function addDay(iso: string, n: number): string {
  const t = Date.parse(iso + "T00:00:00Z");
  return isoDate(new Date(t + n * 86400000));
}

// Shape the first 7 chars (YYYY-MM) into a month key.
function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export async function getSiteAnalytics(
  siteId: string,
  opts: SiteAnalyticsOptions = {},
): Promise<SiteAnalytics> {
  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setUTCFullYear(today.getUTCFullYear() - 1);

  const fromDate = opts.fromDate ?? isoDate(defaultFrom);
  const toDate = opts.toDate ?? isoDate(today);

  const supabase = await createClient();

  // ── 1. Campaign bookings that overlap the window ─────────────────────────
  // Pull every booking where the booking window touches ours.
  const { data: bookings } = await supabase
    .from("campaign_sites")
    .select("campaign_id, start_date, end_date, site_rate_paise, status")
    .eq("site_id", siteId)
    .lte("start_date", toDate)
    .gte("end_date", fromDate);

  const bookingRows = bookings ?? [];

  // ── 2. Paid expenses for this site in the window ─────────────────────────
  const { data: expensesPaid } = await supabase
    .from("site_expenses")
    .select("amount_paise, paid_at")
    .eq("site_id", siteId)
    .eq("status", "paid")
    .gte("paid_at", `${fromDate}T00:00:00Z`)
    .lte("paid_at", `${toDate}T23:59:59Z`);

  // ── 3. Pending expenses (outstanding, regardless of window) ──────────────
  const { data: expensesPending } = await supabase
    .from("site_expenses")
    .select("amount_paise")
    .eq("site_id", siteId)
    .in("status", ["pending", "approved"]);

  // ── 4. Rent cost — contract_payments paid against contracts on this site ─
  // Best-effort: join contracts -> contract_payments. Some projects may not
  // have contract_payments populated; in that case we get 0 here.
  const { data: contracts } = await supabase
    .from("contracts")
    .select("id")
    .eq("site_id", siteId);
  const contractIds = (contracts ?? []).map((c) => c.id);

  let rentPaise = 0;
  if (contractIds.length > 0) {
    const { data: payments } = await supabase
      .from("contract_payments")
      .select("amount_paise, payment_date, status")
      .in("contract_id", contractIds)
      .eq("status", "paid")
      .gte("payment_date", fromDate)
      .lte("payment_date", toDate);
    rentPaise = (payments ?? []).reduce(
      (sum, p) => sum + (p.amount_paise ?? 0),
      0,
    );
  }

  // ── 5. Revenue — sum of site_rate_paise, attributing pro-rata by overlap ──
  // For now a simpler attribution: include the full site_rate if the booking
  // overlaps the window at all. Good enough for a top-line number and keeps
  // the numbers intuitive ("book a campaign, see the full value show up").
  const revenuePaise = bookingRows.reduce(
    (sum, b) => sum + (b.site_rate_paise ?? 0),
    0,
  );

  // ── 6. Expense totals ────────────────────────────────────────────────────
  const expenseCostPaise = (expensesPaid ?? []).reduce(
    (sum, e) => sum + (e.amount_paise ?? 0),
    0,
  );
  const pendingExpensesPaise = (expensesPending ?? []).reduce(
    (sum, e) => sum + (e.amount_paise ?? 0),
    0,
  );

  // ── 7. Occupancy ─────────────────────────────────────────────────────────
  const booked_days = totalCoveredDays(
    bookingRows.map((b) => ({ start: b.start_date, end: b.end_date })),
    fromDate,
    toDate,
  );
  const total_days = dayDiffInclusive(fromDate, toDate);
  const occupancy_pct =
    total_days === 0 ? 0 : Math.round((booked_days / total_days) * 1000) / 10;

  // ── 8. Month-level buckets for the chart ─────────────────────────────────
  // Seed 12 empty buckets ending in `toDate`'s month.
  const buckets: Record<string, { revenue_paise: number; cost_paise: number }> =
    {};
  const cursor = new Date(Date.parse(toDate + "T00:00:00Z"));
  cursor.setUTCDate(1);
  for (let i = 0; i < 12; i++) {
    const k = isoDate(cursor).slice(0, 7);
    buckets[k] = { revenue_paise: 0, cost_paise: 0 };
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }

  // Revenue — attribute each booking's rate to the month its start_date falls
  // in (approximate; fine for the chart). If start < bucket window, use start.
  for (const b of bookingRows) {
    const k = monthKey(b.start_date < fromDate ? fromDate : b.start_date);
    if (k in buckets) {
      buckets[k].revenue_paise += b.site_rate_paise ?? 0;
    }
  }
  for (const e of expensesPaid ?? []) {
    if (!e.paid_at) continue;
    const k = monthKey(e.paid_at.slice(0, 10));
    if (k in buckets) {
      buckets[k].cost_paise += e.amount_paise ?? 0;
    }
  }

  // Rent payments landing inside the window also go into the chart.
  if (contractIds.length > 0) {
    const { data: payments2 } = await supabase
      .from("contract_payments")
      .select("amount_paise, payment_date")
      .in("contract_id", contractIds)
      .eq("status", "paid")
      .gte("payment_date", fromDate)
      .lte("payment_date", toDate);
    for (const p of payments2 ?? []) {
      if (!p.payment_date) continue;
      const k = monthKey(p.payment_date);
      if (k in buckets) {
        buckets[k].cost_paise += p.amount_paise ?? 0;
      }
    }
  }

  const last_12_months = Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));

  // ── 9. Final totals ──────────────────────────────────────────────────────
  const cost_paise = rentPaise + expenseCostPaise;
  const profit_paise = revenuePaise - cost_paise;
  const margin_pct =
    revenuePaise === 0
      ? null
      : Math.round((profit_paise / revenuePaise) * 1000) / 10;

  const campaign_count = new Set(bookingRows.map((b) => b.campaign_id)).size;

  return {
    revenue_paise: revenuePaise,
    rent_cost_paise: rentPaise,
    expense_cost_paise: expenseCostPaise,
    cost_paise,
    profit_paise,
    margin_pct,
    occupancy_pct,
    booked_days,
    total_days,
    campaign_count,
    pending_expenses_paise: pendingExpensesPaise,
    pending_expense_count: (expensesPending ?? []).length,
    last_12_months,
  };
}
