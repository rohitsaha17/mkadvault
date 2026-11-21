// Bookings row — the "what's selling in this period" slice of the
// dashboard, placed directly under the KPI strip so sales momentum is
// visible above the fold. Four cards, each tied to a real sales/ops
// action and scoped to the chosen date range:
//
//   1. Booked value in range    — pro-rata of every campaign's value
//                                 by the days that fall inside the range,
//                                 so a 3-month campaign spanning the
//                                 boundary contributes only its share.
//   2. Live right now           — snapshot of what's on hoardings today
//                                 (not range-dependent; always useful)
//   3. Starting in range        — campaigns whose start_date falls in
//                                 the range → pre-flight ops window
//   4. Ending in range          — campaigns whose end_date falls in
//                                 the range → renewal / dismount window
//
// Every number pro-rates via prorateByRange() so a campaign that
// straddles two periods is counted in each by its actual days-in-period.
import {
  CalendarCheck,
  CalendarClock,
  PlayCircle,
  AlertTriangle,
  ArrowUpRight,
} from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { inr } from "@/lib/utils";
import { prorateByRange, daysInRange } from "@/lib/utils/date-ranges";

interface BookingCardProps {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  iconBg: string;
  href: string;
  tone?: "default" | "warning";
}

export async function BookingsRow({
  orgId,
  locale,
  from,
  to,
}: {
  orgId: string;
  locale: string;
  from: string;
  to: string;
}) {
  const supabase = await createClient();

  const todayStr = new Date().toISOString().slice(0, 10);

  // Pull every campaign that could overlap the range, plus each one's
  // sites (for rate_type / display_rate) and services (for lump-sum
  // amounts). We pro-rate each component independently with the same
  // formula migration 042's trigger uses for campaigns.total_value_paise.
  const [{ data: campaigns }, { data: liveToday }] = await Promise.all([
    supabase
      .from("campaigns")
      .select(
        `
        id,
        total_value_paise,
        start_date,
        end_date,
        status,
        created_at,
        pricing_type,
        campaign_sites(display_rate_paise, rate_type, start_date, end_date),
        campaign_services(total_paise)
      `,
      )
      .eq("organization_id", orgId)
      .not("status", "in", "(cancelled)")
      .is("deleted_at", null)
      .not("start_date", "is", null)
      .not("end_date", "is", null)
      .lte("start_date", to)
      .gte("end_date", from),
    supabase
      .from("campaigns")
      .select("total_value_paise")
      .eq("organization_id", orgId)
      .eq("status", "live")
      .is("deleted_at", null),
  ]);

  type CampaignRow = {
    id: string;
    total_value_paise: number | null;
    start_date: string | null;
    end_date: string | null;
    status: string;
    created_at: string | null;
    pricing_type: "itemized" | "bundled" | null;
    campaign_sites: Array<{
      display_rate_paise: number | null;
      rate_type: "per_month" | "fixed" | null;
      start_date: string | null;
      end_date: string | null;
    }>;
    campaign_services: Array<{ total_paise: number | null }>;
  };

  const rows = (campaigns ?? []) as unknown as CampaignRow[];

  // Compute "Booked value in range" using the same per-site / per-service
  // formula as the campaign-total trigger, so the headline number lines up
  // with the city / location breakdowns below.
  let bookedValueInRange = 0;
  let bookingsInRangeCount = 0;
  for (const c of rows) {
    if (!c.start_date || !c.end_date) continue;

    let campaignShare = 0;

    if (c.pricing_type === "bundled") {
      // Bundled: pro-rate the campaign total by day overlap.
      campaignShare = prorateByRange(
        c.start_date,
        c.end_date,
        c.total_value_paise ?? 0,
        from,
        to,
      );
    } else {
      // Itemized: sum per-site contributions by their rate_type, then
      // add services as a lump sum pro-rated by campaign-level overlap
      // (services don't have their own dates).
      for (const s of c.campaign_sites ?? []) {
        const sf = s.start_date ?? c.start_date;
        const stt = s.end_date ?? c.end_date;
        if (!sf || !stt) continue;
        if (s.rate_type === "per_month") {
          const overlapStart = sf > from ? sf : from;
          const overlapEnd = stt < to ? stt : to;
          if (overlapEnd >= overlapStart) {
            const overlapDays = daysInRange(overlapStart, overlapEnd);
            campaignShare += Math.round(
              ((s.display_rate_paise ?? 0) * overlapDays) / 30,
            );
          }
        } else {
          campaignShare += prorateByRange(
            sf,
            stt,
            s.display_rate_paise ?? 0,
            from,
            to,
          );
        }
      }
      const svcTotal = (c.campaign_services ?? []).reduce(
        (s, r) => s + (r.total_paise ?? 0),
        0,
      );
      if (svcTotal > 0) {
        campaignShare += prorateByRange(
          c.start_date,
          c.end_date,
          svcTotal,
          from,
          to,
        );
      }
    }

    if (campaignShare > 0) {
      bookedValueInRange += campaignShare;
      bookingsInRangeCount += 1;
    }
  }

  // Starting-in-range: campaigns whose start_date is between from and to.
  const startingInRange = rows.filter(
    (c) => c.start_date && c.start_date >= from && c.start_date <= to,
  );
  const startingValue = startingInRange.reduce(
    (s, c) => s + (c.total_value_paise ?? 0),
    0,
  );

  // Ending-in-range: end_date in range.
  const endingInRange = rows.filter(
    (c) => c.end_date && c.end_date >= from && c.end_date <= to,
  );
  const endingValue = endingInRange.reduce(
    (s, c) => s + (c.total_value_paise ?? 0),
    0,
  );
  // Of those ending, how many are still future-or-today so the user can
  // actually act (the past ones are water under the bridge).
  const endingActionable = endingInRange.filter(
    (c) => c.end_date && c.end_date >= todayStr,
  ).length;

  // Live right now — always "today", regardless of range, because the
  // operator always wants to know what's up on their hoardings now.
  const liveCount = (liveToday ?? []).length;
  const liveValue = (liveToday ?? []).reduce(
    (s, c) => s + (c.total_value_paise ?? 0),
    0,
  );

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
          title="Booked Value in Range"
          value={inr(bookedValueInRange)}
          subtitle={
            bookingsInRangeCount > 0
              ? `${bookingsInRangeCount} ${bookingsInRangeCount === 1 ? "campaign" : "campaigns"} overlap (pro-rata)`
              : "No bookings touching this range"
          }
          iconBg="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"
          icon={<CalendarCheck className="h-5 w-5" />}
          href={`/${locale}/campaigns`}
        />
        <BookingCard
          title="Live Right Now"
          value={String(liveCount)}
          subtitle={`${inr(liveValue)} total value running`}
          iconBg="bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"
          icon={<PlayCircle className="h-5 w-5" />}
          href={`/${locale}/campaigns?status=live`}
        />
        <BookingCard
          title="Starting in Range"
          value={String(startingInRange.length)}
          subtitle={`${inr(startingValue)} booked`}
          iconBg="bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300"
          icon={<CalendarClock className="h-5 w-5" />}
          href={`/${locale}/campaigns`}
        />
        <BookingCard
          title="Ending in Range"
          value={String(endingInRange.length)}
          subtitle={
            endingActionable > 0
              ? `${endingActionable} still open · ${inr(endingValue)} up for renewal`
              : `${inr(endingValue)} total ending`
          }
          iconBg={
            endingActionable > 0
              ? "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300"
              : "bg-muted text-muted-foreground"
          }
          icon={<AlertTriangle className="h-5 w-5" />}
          href={`/${locale}/campaigns`}
          tone={endingActionable > 0 ? "warning" : "default"}
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
}: BookingCardProps) {
  const borderClass =
    tone === "warning"
      ? "ring-1 ring-inset ring-amber-200/60 dark:ring-amber-500/20 bg-amber-50/30 dark:bg-amber-500/5"
      : "";
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
        </CardContent>
      </Card>
    </Link>
  );
}
