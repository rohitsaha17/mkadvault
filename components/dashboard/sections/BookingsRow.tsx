// Bookings row — the "what's selling" slice of the dashboard, placed
// directly under the KPI strip so sales momentum is visible above the
// fold. Four cards, each tied to a real sales/ops action:
//
//   1. New bookings this month   — did we book more than last month?
//   2. Booked value (live)       — currently-under-management revenue
//   3. Upcoming in 30 days       — campaigns about to go live; pre-flight
//   4. Ending in 7 days          — renewal / dismount window
//
// Each metric carries its own drill-down link so the owner can click
// through to the filtered Campaigns list and act. Uses the same card
// visual language as KpiRow (gradient wash, iconBg, Progress bar where
// it earns one) so the two rows read as a single prominent header.
import {
  CalendarCheck,
  CalendarClock,
  PlayCircle,
  AlertTriangle,
  ArrowUpRight,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import Link from "next/link";
import { addDays, format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { inr } from "@/lib/utils";

interface BookingCardProps {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  iconBg: string;
  href: string;
  tone?: "default" | "warning";
  trend?: { changePercent: number; vsLabel: string };
}

export async function BookingsRow({
  orgId,
  locale,
}: {
  orgId: string;
  locale: string;
}) {
  const supabase = await createClient();

  const now = new Date();
  const todayStr = format(now, "yyyy-MM-dd");
  const thisMonthStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
  ).toISOString();
  const lastMonthStart = new Date(
    now.getFullYear(),
    now.getMonth() - 1,
    1,
  ).toISOString();
  const lastMonthEnd = new Date(
    now.getFullYear(),
    now.getMonth(),
    0,
    23,
    59,
    59,
  ).toISOString();
  const in7DaysStr = format(addDays(now, 7), "yyyy-MM-dd");
  const in30DaysStr = format(addDays(now, 30), "yyyy-MM-dd");

  // Five parallel queries. Each slices campaigns by a time-boxed
  // signal so the row renders as fast as the slowest.
  const [
    { data: thisMonthBookings },
    { data: lastMonthBookings },
    { data: liveBookings },
    { data: upcomingBookings },
    { data: endingSoonBookings },
  ] = await Promise.all([
    // Newly created (sold) this month — values the BDM closed.
    supabase
      .from("campaigns")
      .select("total_value_paise, created_at")
      .eq("organization_id", orgId)
      .gte("created_at", thisMonthStart)
      .is("deleted_at", null),
    // Last month, same window, for a month-over-month comparison.
    supabase
      .from("campaigns")
      .select("total_value_paise, created_at")
      .eq("organization_id", orgId)
      .gte("created_at", lastMonthStart)
      .lte("created_at", lastMonthEnd)
      .is("deleted_at", null),
    // Currently live — revenue already running on hoardings today.
    supabase
      .from("campaigns")
      .select("total_value_paise")
      .eq("organization_id", orgId)
      .eq("status", "live")
      .is("deleted_at", null),
    // Confirmed but not yet live — kick off in the next 30 days.
    // After migration 035 the only non-terminal statuses are "live"
    // (already running) and anything with a future start_date is a
    // bookings that's queued. We filter by start_date > today AND
    // status != cancelled/completed so dismounts don't bleed in.
    supabase
      .from("campaigns")
      .select("id, total_value_paise, start_date")
      .eq("organization_id", orgId)
      .gt("start_date", todayStr)
      .lte("start_date", in30DaysStr)
      .not("status", "in", "(cancelled,completed)")
      .is("deleted_at", null),
    // Live and wrapping up in ≤7 days — renewal / dismount window.
    supabase
      .from("campaigns")
      .select("id, total_value_paise, end_date")
      .eq("organization_id", orgId)
      .eq("status", "live")
      .gte("end_date", todayStr)
      .lte("end_date", in7DaysStr)
      .is("deleted_at", null),
  ]);

  const sumPaise = (
    rows: Array<{ total_value_paise?: number | null }> | null | undefined,
  ) => (rows ?? []).reduce((s, r) => s + (r.total_value_paise ?? 0), 0);

  const newBookingsCount = (thisMonthBookings ?? []).length;
  const newBookingsValue = sumPaise(thisMonthBookings);
  const lastMonthBookingsValue = sumPaise(lastMonthBookings);
  const bookingsChange =
    lastMonthBookingsValue > 0
      ? ((newBookingsValue - lastMonthBookingsValue) / lastMonthBookingsValue) *
        100
      : 0;

  const liveBookingsCount = (liveBookings ?? []).length;
  const liveBookingsValue = sumPaise(liveBookings);

  const upcomingCount = (upcomingBookings ?? []).length;
  const upcomingValue = sumPaise(upcomingBookings);

  const endingCount = (endingSoonBookings ?? []).length;
  const endingValue = sumPaise(endingSoonBookings);

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Bookings
          </p>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Sales momentum & campaign pipeline
          </h2>
        </div>
        <Link
          href={`/${locale}/campaigns`}
          className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
        >
          View all campaigns
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <BookingCard
          title="New Bookings This Month"
          value={inr(newBookingsValue)}
          subtitle={`${newBookingsCount} ${newBookingsCount === 1 ? "campaign" : "campaigns"} booked`}
          iconBg="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"
          icon={<CalendarCheck className="h-5 w-5" />}
          href={`/${locale}/campaigns`}
          trend={{ changePercent: bookingsChange, vsLabel: "vs last month" }}
        />
        <BookingCard
          title="Live Booked Value"
          value={inr(liveBookingsValue)}
          subtitle={`${liveBookingsCount} ${liveBookingsCount === 1 ? "campaign" : "campaigns"} running now`}
          iconBg="bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"
          icon={<PlayCircle className="h-5 w-5" />}
          href={`/${locale}/campaigns`}
        />
        <BookingCard
          title="Upcoming (Next 30 Days)"
          value={String(upcomingCount)}
          subtitle={`${inr(upcomingValue)} booked, awaiting kick-off`}
          iconBg="bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300"
          icon={<CalendarClock className="h-5 w-5" />}
          href={`/${locale}/campaigns`}
        />
        <BookingCard
          title="Ending in 7 Days"
          value={String(endingCount)}
          subtitle={
            endingCount > 0
              ? `${inr(endingValue)} up for renewal`
              : "Nothing wrapping up this week"
          }
          iconBg={
            endingCount > 0
              ? "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300"
              : "bg-muted text-muted-foreground"
          }
          icon={<AlertTriangle className="h-5 w-5" />}
          href={`/${locale}/campaigns`}
          tone={endingCount > 0 ? "warning" : "default"}
        />
      </div>
    </div>
  );
}

function BookingCard({
  title,
  value,
  subtitle,
  icon,
  iconBg,
  href,
  tone = "default",
  trend,
}: BookingCardProps) {
  const borderClass =
    tone === "warning"
      ? "ring-1 ring-inset ring-amber-200/60 dark:ring-amber-500/20 bg-amber-50/30 dark:bg-amber-500/5"
      : "";
  const isPositiveTrend = (trend?.changePercent ?? 0) >= 0;
  return (
    <Link href={href} className="group">
      <Card
        className={`relative overflow-hidden transition-all hover:shadow-md hover:-translate-y-0.5 ${borderClass}`}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-gradient-to-br from-primary/10 to-transparent blur-2xl"
        />
        <CardHeader className="flex flex-row items-start justify-between pb-3 space-y-0 relative">
          <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {title}
          </CardTitle>
          <div
            className={`h-10 w-10 rounded-xl flex items-center justify-center ring-1 ring-inset ring-border/60 ${iconBg}`}
          >
            {icon}
          </div>
        </CardHeader>
        <CardContent className="relative">
          <div className="text-[28px] font-semibold tabular-nums tracking-tight text-foreground leading-none">
            {value}
          </div>
          <p className="mt-2 text-xs text-muted-foreground tabular-nums">
            {subtitle}
          </p>
          {trend && (
            <div
              className={`mt-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                isPositiveTrend
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                  : "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
              }`}
            >
              {isPositiveTrend ? (
                <TrendingUp className="h-3 w-3" strokeWidth={2.5} />
              ) : (
                <TrendingDown className="h-3 w-3" strokeWidth={2.5} />
              )}
              <span className="tabular-nums">
                {Math.abs(trend.changePercent).toFixed(1)}%
              </span>
              <span className="text-muted-foreground font-normal ml-0.5">
                {trend.vsLabel}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
