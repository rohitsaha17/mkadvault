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
import { setRequestLocale, getTranslations } from "next-intl/server";
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
import { ChartsRow } from "@/components/dashboard/sections/ChartsRow";
import { SecondaryRow } from "@/components/dashboard/sections/SecondaryRow";
import { SitesRow } from "@/components/dashboard/sections/SitesRow";
import { AlertsRow } from "@/components/dashboard/sections/AlertsRow";
import type { UserRole } from "@/lib/types/database";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function DashboardPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const tDash = await getTranslations("dashboard");
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
    <div className="space-y-6">
      {/* Header renders immediately — no awaits above this point cross the
          Suspense boundaries below, so the user sees "Welcome back, X" at
          ~0 ms even before any KPI query resolves. */}
      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {tDash("overview")}
        </p>
        <h1 className="text-2xl md:text-[28px] font-semibold tracking-tight text-foreground leading-tight">
          {profile?.full_name
            ? `${tDash("welcome_back")}, ${profile.full_name.split(" ")[0]}`
            : tDash("welcome_back")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {tDash("dashboard_subtitle")}
        </p>
      </div>

      <Suspense fallback={<KpiRowSkeleton />}>
        <KpiRow orgId={orgId} />
      </Suspense>

      <Suspense fallback={<ChartsRowSkeleton />}>
        <ChartsRow orgId={orgId} />
      </Suspense>

      <Suspense fallback={<SecondaryRowSkeleton />}>
        <SecondaryRow orgId={orgId} />
      </Suspense>

      <Suspense fallback={<SitesRowSkeleton />}>
        <SitesRow orgId={orgId} />
      </Suspense>

      <Suspense fallback={<AlertsRowSkeleton />}>
        <AlertsRow orgId={orgId} locale={locale} />
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
function ChartsRowSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartSkeleton />
      <ChartSkeleton />
    </div>
  );
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
    const [
      { data: pipeline },
      { data: availableSites },
      { data: todayMountings },
      { data: weekMountings },
      { data: maintenanceSites },
    ] = await Promise.all([
      supabase
        .from("campaigns")
        .select("status, total_value_paise")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .in("status", ["enquiry", "proposal_sent", "confirmed", "live"]),
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

    const enquiries = (pipeline ?? []).filter((c) => c.status === "enquiry").length;
    const proposals = (pipeline ?? []).filter((c) => c.status === "proposal_sent").length;
    const confirmed = (pipeline ?? []).filter((c) => c.status === "confirmed").length;
    const live = (pipeline ?? []).filter((c) => c.status === "live").length;
    const pipelineValue = (pipeline ?? []).reduce(
      (s, c) => s + (c.total_value_paise ?? 0),
      0,
    );

    return (
      <RoleWrapper greeting={greeting} role={role === "manager" ? "Manager" : "Executive"}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <SimpleStatCard label="Enquiries" value={String(enquiries)} />
          <SimpleStatCard label="Proposals Out" value={String(proposals)} />
          <SimpleStatCard label="Confirmed" value={String(confirmed)} />
          <SimpleStatCard label="Live" value={String(live)} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <SimpleStatCard
            label="Pipeline Value"
            value={new Intl.NumberFormat("en-IN", {
              style: "currency",
              currency: "INR",
              maximumFractionDigits: 0,
            }).format(pipelineValue / 100)}
          />
          <SimpleStatCard label="Available Sites" value={String((availableSites ?? []).length)} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
          <SimpleStatCard label="Mountings Today" value={String((todayMountings ?? []).length)} />
          <SimpleStatCard label="Mountings This Week" value={String((weekMountings ?? []).length)} />
          <SimpleStatCard label="Sites Under Maintenance" value={String((maintenanceSites ?? []).length)} />
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

function SimpleStatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className="text-2xl font-bold text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}
