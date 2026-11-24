// Dashboard home — owner / admin view with full KPIs, charts, pipeline &
// alerts. Each row fetches its own data and renders under its OWN Suspense
// boundary so fast queries paint while slow ones are still in-flight.
// Compared to the old "one big Promise.all then render everything" shape,
// this makes the page feel dramatically faster: the header renders at
// ~0 ms, KPIs stream in at ~80 ms, charts at ~150 ms, etc., rather than
// the whole page blocking on the slowest query.
//
// Role-specific simplified views (executive / manager / accounts / viewer)
// still live in-file because they're much smaller.

import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { format, addDays, parseISO } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";
import { autoCompletePastDueCampaigns } from "@/lib/campaigns/auto-complete";
import {
  KPICardSkeleton,
  ChartSkeleton,
  TableSkeleton,
} from "@/components/shared/PageSkeleton";
import { KpiRow } from "@/components/dashboard/sections/KpiRow";
import { BookingsRow } from "@/components/dashboard/sections/BookingsRow";
import { ChartsRow } from "@/components/dashboard/sections/ChartsRow";
import { SecondaryRow } from "@/components/dashboard/sections/SecondaryRow";
import { SitesRow } from "@/components/dashboard/sections/SitesRow";
import { AlertsRow } from "@/components/dashboard/sections/AlertsRow";
import { CityBookingsRow } from "@/components/dashboard/sections/CityBookingsRow";
import { LocationBookingsRow } from "@/components/dashboard/sections/LocationBookingsRow";
import { DashboardFilters } from "@/components/dashboard/DashboardFilters";
import { resolveDashboardRange } from "@/lib/utils/date-ranges";
import type { UserRole } from "@/lib/types/database";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}

// Name the window the page is scoped to, concretely. "FY 2026-27",
// "Oct 2026", "This quarter" — whichever reads clearest for the preset.
// Falls back to a date-range for custom and anything we don't recognise.
function dashboardHeadline(
  preset: string | undefined,
  from: string,
  to: string,
): string {
  // parseISO on a YYYY-MM-DD string returns LOCAL midnight — so we
  // must read it with the local getters, not the UTC ones, or the IST
  // offset shifts April 1 into March 31 of the previous year and we
  // end up calling this "FY 2025-26" when the window is actually 26-27.
  const start = parseISO(from);
  const end = parseISO(to);
  // Indian FY: Apr 1 → Mar 31. Named by the two calendar years it spans.
  const fyLabel = (d: Date) => {
    const y = d.getFullYear();
    // Months Jan–Mar belong to FY (y-1)→y.
    return d.getMonth() < 3 ? `FY ${y - 1}-${String(y).slice(2)}` : `FY ${y}-${String(y + 1).slice(2)}`;
  };
  switch (preset) {
    case "current_fy":
    case "last_fy":
      return fyLabel(start);
    case "ytd":
      return `Year to date · ${format(end, "d MMM yyyy")}`;
    case "this_month":
    case "last_month":
      return format(start, "MMMM yyyy");
    case "current_quarter":
    case "last_quarter":
      return `${fyLabel(start)} · ${format(start, "MMM")}–${format(end, "MMM")}`;
    case "today":
      return format(start, "EEEE, d MMM yyyy");
    case "yesterday":
      return format(start, "EEEE, d MMM yyyy");
    case "this_week":
    case "last_week":
      return `Week of ${format(start, "d MMM yyyy")}`;
    case "all":
      return "All time";
    default:
      return `${format(start, "d MMM yyyy")} – ${format(end, "d MMM yyyy")}`;
  }
}

export default async function DashboardPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const { range, from, to } = await searchParams;
  setRequestLocale(locale);

  const session = await getSession();

  if (!session) redirect(`/${locale}/login`);
  const { profile } = session;

  if (!profile?.org_id) {
    return (
      <div className="p-6 text-center text-muted-foreground text-sm">
        Your account is not linked to an organisation yet. Contact your
        administrator.
      </div>
    );
  }

  const orgId: string = profile.org_id;
  const role: UserRole = profile.role as UserRole;
  const isAdmin = role === "super_admin" || role === "admin";

  // Resolve the dashboard date range once and plumb it through every
  // range-aware section. Falls back to current FY if the URL has no
  // preset or the custom from/to pair is invalid.
  const { preset, from: rangeFrom, to: rangeTo } = resolveDashboardRange({
    preset: range,
    from,
    to,
  });

  // Fire-and-forget cleanup of past-due campaigns. We don't await — the
  // UI shouldn't block on this background housekeeping.
  const supabase = await createClient();
  autoCompletePastDueCampaigns(supabase).catch(() => {});

  if (!isAdmin) {
    return (
      <RoleSpecificDashboard
        role={role}
        orgId={orgId}
        locale={locale}
        profile={{ full_name: profile.full_name }}
      />
    );
  }

  // Full admin dashboard — streamed in sections.
  return (
    <div className="space-y-6 pb-4">
      {/* Header renders immediately — no awaits above this point cross
          the Suspense boundaries below, so the title paints at ~0 ms
          even before any KPI query resolves. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Overview</p>
          <h1 className="text-[32px] md:text-[40px] font-semibold leading-none text-foreground tracking-tight">
            {dashboardHeadline(preset, rangeFrom, rangeTo)}
          </h1>
        </div>
        <DashboardFilters
          currentPreset={preset}
          from={rangeFrom}
          to={rangeTo}
        />
      </div>

      <Suspense fallback={<KpiRowSkeleton />}>
        <KpiRow orgId={orgId} from={rangeFrom} to={rangeTo} />
      </Suspense>

      <Suspense fallback={<BookingsRowSkeleton />}>
        <BookingsRow
          orgId={orgId}
          locale={locale}
          from={rangeFrom}
          to={rangeTo}
        />
      </Suspense>

      <Suspense fallback={<ChartsRowSkeleton />}>
        <ChartsRow orgId={orgId} from={rangeFrom} to={rangeTo} />
      </Suspense>

      <Suspense fallback={<CityRowSkeleton />}>
        <CityBookingsRow orgId={orgId} from={rangeFrom} to={rangeTo} />
      </Suspense>

      <Suspense fallback={<LocationRowSkeleton />}>
        <LocationBookingsRow orgId={orgId} from={rangeFrom} to={rangeTo} />
      </Suspense>

      <Suspense fallback={<SecondaryRowSkeleton />}>
        <SecondaryRow orgId={orgId} />
      </Suspense>

      <Suspense fallback={<SitesRowSkeleton />}>
        <SitesRow orgId={orgId} from={rangeFrom} to={rangeTo} />
      </Suspense>

      <Suspense fallback={<AlertsRowSkeleton />}>
        <AlertsRow
          orgId={orgId}
          locale={locale}
          from={rangeFrom}
          to={rangeTo}
        />
      </Suspense>
    </div>
  );
}

// ─── Skeletons (match the real row layouts so nothing jumps) ─────────────────

function KpiRowSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <KPICardSkeleton key={i} />
      ))}
    </div>
  );
}
function BookingsRowSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <div className="h-3 w-20 bg-muted/70 rounded animate-pulse" />
          <div className="h-5 w-64 bg-muted rounded animate-pulse" />
        </div>
        <div className="h-3 w-32 bg-muted/70 rounded animate-pulse" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <KPICardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
function ChartsRowSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartSkeleton />
      <ChartSkeleton />
    </div>
  );
}
function CityRowSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartSkeleton />
      <ChartSkeleton />
    </div>
  );
}
function LocationRowSkeleton() {
  return <TableSkeleton rows={8} cols={5} />;
}
function SecondaryRowSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="pt-5">
            <div className="h-4 w-24 bg-muted rounded animate-pulse mb-3" />
            <div className="space-y-2">
              <div className="h-4 w-full bg-muted/70 rounded animate-pulse" />
              <div className="h-4 w-5/6 bg-muted/70 rounded animate-pulse" />
              <div className="h-4 w-4/6 bg-muted/70 rounded animate-pulse" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
function SitesRowSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <TableSkeleton rows={5} cols={4} />
      <TableSkeleton rows={5} cols={4} />
    </div>
  );
}
function AlertsRowSkeleton() {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="h-5 w-40 bg-muted rounded animate-pulse mb-3" />
        <div className="space-y-2">
          <div className="h-10 w-full bg-muted/70 rounded animate-pulse" />
          <div className="h-10 w-full bg-muted/70 rounded animate-pulse" />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── RoleSpecificDashboard (non-admin roles) ─────────────────────────────────
// Kept inline because these are small (few queries, one render) and each
// role sees only what's relevant to its job. If any of these grow, lift
// them to sections/ too.

async function RoleSpecificDashboard({
  role,
  orgId,
  profile,
}: {
  role: UserRole;
  orgId: string;
  locale: string;
  profile: { full_name: string | null };
}) {
  const supabase = await createClient();

  const now = new Date();
  const todayStr = format(now, "yyyy-MM-dd");
  const weekEnd = format(addDays(now, 7), "yyyy-MM-dd");
  const thirtyDaysFromNow = addDays(now, 30).toISOString();

  const greeting = profile.full_name
    ? `Welcome back, ${profile.full_name}`
    : "Welcome back";

  if (role === "executive" || role === "manager") {
    const thisMonthStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
    ).toISOString();
    const in30DaysStr = format(addDays(now, 30), "yyyy-MM-dd");

    const [
      { data: livePipeline },
      { data: newThisMonth },
      { data: upcoming },
      { data: availableSites },
      { data: todayMountings },
      { data: weekMountings },
      { data: maintenanceSites },
    ] = await Promise.all([
      supabase
        .from("campaigns")
        .select("status, total_value_paise, end_date")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .eq("status", "live"),
      supabase
        .from("campaigns")
        .select("total_value_paise")
        .eq("organization_id", orgId)
        .gte("created_at", thisMonthStart)
        .is("deleted_at", null),
      supabase
        .from("campaigns")
        .select("total_value_paise, start_date")
        .eq("organization_id", orgId)
        .gt("start_date", todayStr)
        .lte("start_date", in30DaysStr)
        .not("status", "in", "(cancelled,completed)")
        .is("deleted_at", null),
      supabase
        .from("sites")
        .select("id")
        .eq("organization_id", orgId)
        .eq("status", "available")
        .is("deleted_at", null),
      supabase
        .from("campaign_sites")
        .select("id, site_id")
        .eq("organization_id", orgId)
        .eq("mounting_date", todayStr),
      supabase
        .from("campaign_sites")
        .select("id, site_id")
        .eq("organization_id", orgId)
        .gte("mounting_date", todayStr)
        .lte("mounting_date", weekEnd),
      supabase
        .from("sites")
        .select("id")
        .eq("organization_id", orgId)
        .eq("status", "maintenance")
        .is("deleted_at", null),
    ]);

    // Break live pipeline down by "ending soon" so the sales/ops team can act.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const in7Days = new Date(today);
    in7Days.setDate(in7Days.getDate() + 7);
    const live = livePipeline?.length ?? 0;
    const endingSoon = (livePipeline ?? []).filter((c) => {
      if (!c.end_date) return false;
      const end = new Date(c.end_date);
      return end >= today && end <= in7Days;
    }).length;
    const livePipelineValue = (livePipeline ?? []).reduce(
      (s, c) => s + (c.total_value_paise ?? 0),
      0,
    );
    const newThisMonthValue = (newThisMonth ?? []).reduce(
      (s, c) => s + (c.total_value_paise ?? 0),
      0,
    );
    const newThisMonthCount = (newThisMonth ?? []).length;
    const upcomingCount = (upcoming ?? []).length;
    const upcomingValue = (upcoming ?? []).reduce(
      (s, c) => s + (c.total_value_paise ?? 0),
      0,
    );

    const fmtInr = (p: number) =>
      new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(p / 100);

    return (
      <RoleWrapper
        greeting={greeting}
        role={role === "manager" ? "Manager" : "Executive"}
      >
        {/* Primary booking strip — biggest numbers, four wide cards. */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-2">
            Bookings
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <SimpleStatCard
              label="New This Month"
              value={fmtInr(newThisMonthValue)}
              subtitle={`${newThisMonthCount} ${newThisMonthCount === 1 ? "campaign" : "campaigns"}`}
              highlight
            />
            <SimpleStatCard
              label="Live Booked Value"
              value={fmtInr(livePipelineValue)}
              subtitle={`${live} running now`}
              highlight
            />
            <SimpleStatCard
              label="Upcoming (30d)"
              value={String(upcomingCount)}
              subtitle={fmtInr(upcomingValue)}
            />
            <SimpleStatCard
              label="Ending in 7 days"
              value={String(endingSoon)}
              subtitle={endingSoon > 0 ? "Needs renewal" : "Nothing closing"}
            />
          </div>
        </div>

        {/* Operations strip — mountings & site availability. */}
        <div className="mt-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-2">
            Operations
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <SimpleStatCard
              label="Available Sites"
              value={String((availableSites ?? []).length)}
            />
            <SimpleStatCard
              label="Mountings Today"
              value={String((todayMountings ?? []).length)}
            />
            <SimpleStatCard
              label="Mountings This Week"
              value={String((weekMountings ?? []).length)}
            />
            <SimpleStatCard
              label="Under Maintenance"
              value={String((maintenanceSites ?? []).length)}
            />
          </div>
        </div>
      </RoleWrapper>
    );
  }

  if (role === "accounts") {
    const [{ data: overdueInvoices }, { data: payablesDue }] = await Promise.all([
      supabase
        .from("invoices")
        .select("balance_due_paise, due_date")
        .eq("organization_id", orgId)
        .in("status", ["sent", "partially_paid", "overdue"])
        .is("deleted_at", null),
      supabase
        .from("contract_payments")
        .select("amount_due_paise")
        .eq("organization_id", orgId)
        .in("status", ["upcoming", "due", "overdue"])
        .lte("due_date", thirtyDaysFromNow),
    ]);

    const totalReceivable = (overdueInvoices ?? []).reduce(
      (s, i) => s + (i.balance_due_paise ?? 0),
      0,
    );
    const overdueCount = (overdueInvoices ?? []).filter((i) => {
      const daysOverdue = Math.floor(
        (now.getTime() - parseISO(i.due_date).getTime()) / (1000 * 60 * 60 * 24),
      );
      return daysOverdue > 0;
    }).length;
    const totalPayable = (payablesDue ?? []).reduce(
      (s, p) => s + (p.amount_due_paise ?? 0),
      0,
    );

    const fmt = (p: number) =>
      new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(p / 100);

    return (
      <RoleWrapper greeting={greeting} role="Accounts">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SimpleStatCard label="Total Receivable" value={fmt(totalReceivable)} />
          <SimpleStatCard label="Overdue Invoices" value={String(overdueCount)} />
          <SimpleStatCard label="Payables Due (30d)" value={fmt(totalPayable)} />
        </div>
      </RoleWrapper>
    );
  }

  const [{ data: sitesAll }, { data: campaignsLive }] = await Promise.all([
    supabase
      .from("sites")
      .select("id")
      .eq("organization_id", orgId)
      .is("deleted_at", null),
    supabase
      .from("campaigns")
      .select("id")
      .eq("organization_id", orgId)
      .eq("status", "live")
      .is("deleted_at", null),
  ]);

  return (
    <RoleWrapper greeting={greeting} role="Viewer">
      <div className="grid grid-cols-2 gap-4">
        <SimpleStatCard label="Total Sites" value={String((sitesAll ?? []).length)} />
        <SimpleStatCard label="Live Campaigns" value={String((campaignsLive ?? []).length)} />
      </div>
    </RoleWrapper>
  );
}

function RoleWrapper({
  greeting,
  role,
  children,
}: {
  greeting: string;
  role: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">{greeting}</h2>
        <p className="text-sm text-muted-foreground mt-1">{role} dashboard</p>
      </div>
      {children}
    </div>
  );
}

function SimpleStatCard({
  label,
  value,
  subtitle,
  highlight,
}: {
  label: string;
  value: string;
  subtitle?: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "ring-1 ring-primary/20 bg-primary/5" : ""}>
      <CardContent className="pt-5">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className="text-2xl font-bold tabular-nums text-foreground">
          {value}
        </p>
        {subtitle && (
          <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
            {subtitle}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
