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
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { format, addDays } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";
import { autoCompletePastDueCampaigns } from "@/lib/campaigns/auto-complete";
import { loadPayablesSummary } from "@/lib/payables";
import { OPEN_INVOICE_STATUSES, summariseReceivables } from "@/lib/receivables";
import { todayInIndia } from "@/lib/utils/time-buckets";
import {
  KPICardSkeleton,
  ChartSkeleton,
  TableSkeleton,
} from "@/components/shared/PageSkeleton";
import { KpiRow } from "@/components/dashboard/sections/KpiRow";
import { HeroStats } from "@/components/dashboard/sections/HeroStats";
import { LiveBoard } from "@/components/dashboard/sections/LiveBoard";
import { ChartsRow } from "@/components/dashboard/sections/ChartsRow";
import { SecondaryRow } from "@/components/dashboard/sections/SecondaryRow";
import { SitesRow } from "@/components/dashboard/sections/SitesRow";
import { AlertsRow } from "@/components/dashboard/sections/AlertsRow";
import { CityBookingsRow } from "@/components/dashboard/sections/CityBookingsRow";
import { LocationBookingsRow } from "@/components/dashboard/sections/LocationBookingsRow";
import { DashboardFilters } from "@/components/dashboard/DashboardFilters";
import { HeroBanner } from "@/components/dashboard/HeroBanner";
import { IconTile, type IconName } from "@/components/dashboard/IconTile";
import { resolveDashboardRange } from "@/lib/utils/date-ranges";
import type { UserRole } from "@/lib/types/database";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}

type DashboardT = Awaited<ReturnType<typeof getTranslations>>;

// Dates are formatted from YYYY-MM-DD as UTC midnights so the IST offset can
// never slide 1 April back into the previous financial year.
function formatDay(
  date: string,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-GB", {
    ...options,
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

// Name the window the page is scoped to, concretely: "FY 2026-27",
// "November 2026", a date range for anything custom.
function dashboardHeadline(
  preset: string | undefined,
  from: string,
  to: string,
  locale: string,
  t: DashboardT,
): string {
  const day = { day: "numeric", month: "short", year: "numeric" } as const;
  // Indian FY: 1 Apr → 31 Mar, named by the two calendar years it spans.
  const [year, month] = from.split("-").map(Number);
  const fyStart = month < 4 ? year - 1 : year;
  const fy = t("headline_fy", {
    years: `${fyStart}-${String(fyStart + 1).slice(2)}`,
  });

  switch (preset) {
    case "current_fy":
    case "last_fy":
      return fy;
    case "ytd":
      return t("headline_ytd", { date: formatDay(to, locale, day) });
    case "this_month":
    case "last_month":
      return formatDay(from, locale, { month: "long", year: "numeric" });
    case "current_quarter":
    case "last_quarter":
      return `${fy}, ${formatDay(from, locale, { month: "short" })}–${formatDay(to, locale, { month: "short" })}`;
    case "today":
    case "yesterday":
      return formatDay(from, locale, {
        weekday: "long",
        day: "numeric",
        month: "short",
      });
    case "this_week":
    case "last_week":
      return t("headline_week", { date: formatDay(from, locale, day) });
    case "all":
      return t("headline_all");
    default:
      return `${formatDay(from, locale, day)} – ${formatDay(to, locale, day)}`;
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

  const t = await getTranslations("dashboard");
  const todayLabel = new Intl.DateTimeFormat(
    locale === "hi" ? "hi-IN" : "en-IN",
    {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "Asia/Kolkata",
    },
  ).format(new Date());

  // Full admin dashboard — streamed in sections. The hero frame, artwork and
  // heading render straight away; everything that needs a query streams in.
  return (
    <div className="space-y-4 pb-4">
      <HeroBanner
        eyebrow={todayLabel}
        title={dashboardHeadline(preset, rangeFrom, rangeTo, locale, t)}
        filters={
          <DashboardFilters
            currentPreset={preset}
            from={rangeFrom}
            to={rangeTo}
          />
        }
        board={
          <Suspense fallback={null}>
            <LiveBoard orgId={orgId} />
          </Suspense>
        }
        stats={
          <Suspense fallback={<HeroStatsSkeleton />}>
            <HeroStats orgId={orgId} from={rangeFrom} to={rangeTo} />
          </Suspense>
        }
      />

      <Suspense fallback={<KpiRowSkeleton />}>
        <KpiRow orgId={orgId} from={rangeFrom} to={rangeTo} />
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

function HeroStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="glass h-[132px] animate-pulse rounded-2xl sm:h-[98px]"
        />
      ))}
    </div>
  );
}
function KpiRowSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <KPICardSkeleton key={i} className="h-[248px] rounded-3xl" />
      ))}
    </div>
  );
}
function ChartsRowSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
      <ChartSkeleton className="rounded-3xl xl:col-span-3" />
      <ChartSkeleton className="rounded-3xl xl:col-span-2" />
    </div>
  );
}
function CityRowSkeleton() {
  return <ChartSkeleton className="rounded-3xl" />;
}
function LocationRowSkeleton() {
  return <TableSkeleton rows={8} cols={5} />;
}
function SecondaryRowSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} className="h-72 rounded-3xl">
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
        boardOrgId={orgId}
      >
        {/* Primary booking strip — biggest numbers, four wide cards. */}
        <div>
          <h3 className="mb-3 text-xl font-semibold">Bookings</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <SimpleStatCard
              icon="coins"
              label="New this month"
              value={fmtInr(newThisMonthValue)}
              subtitle={`${newThisMonthCount} ${newThisMonthCount === 1 ? "campaign" : "campaigns"}`}
              highlight
            />
            <SimpleStatCard
              icon="megaphone"
              label="Live booked value"
              value={fmtInr(livePipelineValue)}
              subtitle={`${live} running now`}
              highlight
            />
            <SimpleStatCard
              icon="calendar"
              label="Upcoming (30 days)"
              value={String(upcomingCount)}
              subtitle={fmtInr(upcomingValue)}
            />
            <SimpleStatCard
              icon="bell"
              label="Ending in 7 days"
              value={String(endingSoon)}
              subtitle={endingSoon > 0 ? "Needs renewal" : "Nothing closing"}
            />
          </div>
        </div>

        {/* Operations strip — mountings & site availability. */}
        <div className="mt-6">
          <h3 className="mb-3 text-xl font-semibold">Operations</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <SimpleStatCard
              icon="hoarding"
              label="Available sites"
              value={String((availableSites ?? []).length)}
            />
            <SimpleStatCard
              icon="pin"
              label="Mountings today"
              value={String((todayMountings ?? []).length)}
            />
            <SimpleStatCard
              icon="calendar"
              label="Mountings this week"
              value={String((weekMountings ?? []).length)}
            />
            <SimpleStatCard
              icon="hoarding"
              label="Under maintenance"
              value={String((maintenanceSites ?? []).length)}
            />
          </div>
        </div>
      </RoleWrapper>
    );
  }

  if (role === "accounts") {
    const [{ data: openInvoices, error: receivablesError }, payables] = await Promise.all([
      supabase
        .from("invoices")
        .select("balance_due_paise, due_date, status")
        .eq("organization_id", orgId)
        .in("status", OPEN_INVOICE_STATUSES)
        .is("deleted_at", null),
      loadPayablesSummary(supabase, todayInIndia()),
    ]);

    // null = couldn't be read. Shown as "—", never as ₹0.
    const receivables = receivablesError
      ? null
      : summariseReceivables(openInvoices ?? [], todayInIndia());

    const fmt = (p: number) =>
      new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(p / 100);

    return (
      <RoleWrapper greeting={greeting} role="Accounts">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SimpleStatCard icon="coins" label="Total receivable" value={receivables ? fmt(receivables.outstanding) : "—"} />
          <SimpleStatCard
            icon="bell"
            label="Overdue invoices"
            value={receivables ? String(receivables.overdueCount) : "—"}
            subtitle={receivables ? fmt(receivables.overdue) : "Couldn't load invoices"}
          />
          <SimpleStatCard
            icon="receipt"
            label="Payables due (30 days)"
            value={payables ? fmt(payables.dueSoon) : "—"}
            subtitle={payables ? undefined : "Couldn't load payables"}
          />
          <SimpleStatCard
            icon="calendar"
            label="Overdue payables"
            value={payables ? fmt(payables.overdue) : "—"}
            subtitle={
              !payables
                ? "Couldn't load payables"
                : payables.oldestOverdue
                  ? `${payables.overdueCount} unpaid, oldest due ${formatDay(payables.oldestOverdue, "en", { day: "numeric", month: "short", year: "numeric" })}`
                  : "Nothing overdue"
            }
          />
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
    <RoleWrapper greeting={greeting} role="Viewer" boardOrgId={orgId}>
      <div className="grid grid-cols-2 gap-4">
        <SimpleStatCard icon="hoarding" label="Total sites" value={String((sitesAll ?? []).length)} />
        <SimpleStatCard icon="megaphone" label="Live campaigns" value={String((campaignsLive ?? []).length)} />
      </div>
    </RoleWrapper>
  );
}

function RoleWrapper({
  greeting,
  role,
  boardOrgId,
  children,
}: {
  greeting: string;
  role: string;
  // When set, the hoarding shows the live campaign count. Left out for roles
  // whose dashboard doesn't otherwise show campaigns.
  boardOrgId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6 pb-4">
      <HeroBanner
        eyebrow={`${role} dashboard`}
        title={greeting}
        board={
          boardOrgId ? (
            <Suspense fallback={null}>
              <LiveBoard orgId={boardOrgId} />
            </Suspense>
          ) : undefined
        }
      />
      {children}
    </div>
  );
}

function SimpleStatCard({
  icon,
  label,
  value,
  subtitle,
  highlight,
}: {
  icon: IconName;
  label: string;
  value: string;
  subtitle?: string;
  highlight?: boolean;
}) {
  return (
    <Card
      className={`h-full rounded-3xl ${highlight ? "ring-1 ring-primary/30" : ""}`}
    >
      <CardContent className="flex h-full flex-col justify-between gap-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-muted-foreground">{label}</p>
          <IconTile name={icon} size={44} />
        </div>
        <div>
          <p className="figure text-2xl text-foreground sm:text-3xl">{value}</p>
          {subtitle && (
            <p className="mt-2 text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
