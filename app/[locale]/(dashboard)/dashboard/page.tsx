// Dashboard home — owner / admin view with full KPIs, charts, pipeline & alerts.
// Role-specific simplified views are rendered inline for non-admin roles.
//
// Data fetching strategy: all queries run in parallel with Promise.all so the
// page loads as fast as possible.  All monetary values are in integer PAISE.

import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { format, addDays, parseISO } from "date-fns";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  BarChart2,
  Building2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";
import { inr } from "@/lib/utils";
import { autoCompletePastDueCampaigns } from "@/lib/campaigns/auto-complete";
import { RevenueCostChart, CashFlowChart } from "@/components/dashboard/DashboardCharts";
import { DashboardAlerts } from "@/components/dashboard/DashboardAlerts";
import type {
  Alert,
  CampaignStatus,
  UserRole,
} from "@/lib/types/database";

// ─── Month key helper (e.g. "Apr 25") ─────────────────────────────────────────

function monthKey(dateStr: string): string {
  return format(parseISO(dateStr), "MMM yy");
}

// ─── Build an ordered array of the last N month keys ─────────────────────────

function lastNMonthKeys(n: number): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(format(d, "MMM yy"));
  }
  return keys;
}

// ─── Page props ───────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ locale: string }>;
}

// ─── Types for internal data shapes ──────────────────────────────────────────

interface SiteRow {
  id: string;
  name: string;
  site_code: string;
}

interface CampaignSiteWithCampaign {
  site_id: string;
  display_rate_paise: number | null;
  campaign: { status: CampaignStatus } | null;
}

interface ContractPaymentWithContract {
  amount_paid_paise: number | null;
  contract: { site_id: string } | null;
}

interface CampaignPipelineRow {
  status: CampaignStatus;
  total_value_paise: number | null;
}

interface InvoiceAgingRow {
  due_date: string;
  balance_due_paise: number;
}

interface MonthlyInvoiceRow {
  invoice_date: string;
  total_paise: number;
}

interface MonthlyCostRow {
  payment_date: string | null;
  amount_paid_paise: number | null;
}

interface MonthlyPaymentRow {
  payment_date: string;
  amount_paise: number;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
// Rich KPI card: icon pill top-right, big tabular-nums value, coloured
// trend chip with direction arrow. Uses theme tokens so it adapts to dark mode.

function KpiCard({
  title,
  value,
  changePercent,
  icon,
  iconBg,
  vsLabel = "vs last month",
}: {
  title: string;
  value: string;
  changePercent: number;
  icon: React.ReactNode;
  iconBg: string;
  vsLabel?: string;
}) {
  const isPositive = changePercent >= 0;

  return (
    <Card className="relative overflow-hidden">
      {/* Subtle brand gradient wash behind the top-right corner */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-gradient-to-br from-primary/10 to-transparent blur-2xl"
      />
      <CardHeader className="flex flex-row items-start justify-between pb-3 space-y-0 relative">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </CardTitle>
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center ring-1 ring-inset ring-border/60 ${iconBg}`}>
          {icon}
        </div>
      </CardHeader>
      <CardContent className="relative">
        <div className="text-[28px] font-semibold tabular-nums tracking-tight text-foreground leading-none">
          {value}
        </div>
        <div
          className={`mt-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            isPositive
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
              : "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
          }`}
        >
          {isPositive ? (
            <TrendingUp className="h-3 w-3" strokeWidth={2.5} />
          ) : (
            <TrendingDown className="h-3 w-3" strokeWidth={2.5} />
          )}
          <span className="tabular-nums">
            {Math.abs(changePercent).toFixed(1)}%
          </span>
          <span className="text-muted-foreground font-normal ml-0.5">{vsLabel}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Occupancy card (uses progress bar instead of INR) ───────────────────────

function OccupancyCard({
  booked,
  total,
  title,
  bookedLabel,
}: {
  booked: number;
  total: number;
  title: string;
  bookedLabel: string;
}) {
  const pct = total > 0 ? Math.round((booked / total) * 100) : 0;

  return (
    <Card className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-gradient-to-br from-violet-500/10 to-transparent blur-2xl"
      />
      <CardHeader className="flex flex-row items-start justify-between pb-3 space-y-0 relative">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </CardTitle>
        <div className="h-10 w-10 rounded-xl flex items-center justify-center ring-1 ring-inset ring-border/60 bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
          <Building2 className="h-5 w-5" />
        </div>
      </CardHeader>
      <CardContent className="relative">
        <div className="text-[28px] font-semibold tabular-nums tracking-tight text-foreground leading-none">
          {pct}%
        </div>
        <Progress value={pct} className="mt-4 h-1.5" />
        <p className="mt-2 text-xs text-muted-foreground tabular-nums">
          {booked} {bookedLabel}
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default async function DashboardPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const tDash = await getTranslations("dashboard");
  const supabase = await createClient();

  // Get cached session (user + profile). Cached per-request so this is free
  // if the layout also called getSession().
  const session = await getSession();

  if (!session) {
    redirect(`/${locale}/login`);
  }

  const { profile } = session;

  if (!profile?.org_id) {
    // Profile not set up yet — show minimal screen
    return (
      <div className="p-6 text-center text-muted-foreground text-sm">
        Your account is not linked to an organisation yet. Contact your administrator.
      </div>
    );
  }

  const orgId: string = profile.org_id;
  const role: UserRole = profile.role as UserRole;

  // ── Auto-complete campaigns whose end date has passed ─────────────────────
  // Fire-and-forget on dashboard load so stale campaigns get cleaned up
  // even if the cron job hasn't run yet. Uses the user's client (RLS-scoped).
  autoCompletePastDueCampaigns(supabase).catch(() => {});

  // ── Date range constants ───────────────────────────────────────────────────
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();
  const thirtyDaysFromNow = addDays(now, 30).toISOString();

  // ── Role-specific simplified dashboards ───────────────────────────────────
  // Only super_admin and admin see the full dashboard.
  // Other roles see a focused view relevant to their work.

  const isAdmin = role === "super_admin" || role === "admin";

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

  // ── Full admin dashboard — fetch all data in parallel ─────────────────────

  const [
    // KPI: this month revenue
    { data: thisMonthInvoices },
    // KPI: last month revenue
    { data: lastMonthInvoices },
    // KPI: this month costs
    { data: thisMonthCosts },
    // KPI: last month costs
    { data: lastMonthCosts },
    // Occupancy: all sites + booked count
    { data: allSites },
    { data: bookedSites },
    // 12-month revenue chart
    { data: twelveMonthInvoices },
    // 12-month costs chart
    { data: twelveMonthCosts },
    // 6-month cash inflow (payments_received)
    { data: sixMonthPayments },
    // 6-month cash outflow (contract_payments)
    { data: sixMonthOutflow },
    // Aging: outstanding receivables
    { data: agingInvoices },
    // Payables: due soon
    { data: payablesDueSoon },
    // Payables: overdue
    { data: payablesOverdue },
    // Campaign pipeline
    { data: pipelineCampaigns },
    // Top/bottom sites — revenue by site
    { data: revenueBySite },
    // Top/bottom sites — costs by contract
    { data: costsByContract },
    // Site names for top/bottom calculation
    { data: siteRows },
    // Critical/warning alerts
    { data: alertRows },
  ] = await Promise.all([
    // This month invoices
    supabase
      .from("invoices")
      .select("total_paise")
      .eq("organization_id", orgId)
      .gte("invoice_date", thisMonthStart)
      .is("deleted_at", null),

    // Last month invoices
    supabase
      .from("invoices")
      .select("total_paise")
      .eq("organization_id", orgId)
      .gte("invoice_date", lastMonthStart)
      .lte("invoice_date", lastMonthEnd)
      .is("deleted_at", null),

    // This month contract payments (costs)
    supabase
      .from("contract_payments")
      .select("amount_paid_paise")
      .eq("organization_id", orgId)
      .eq("status", "paid")
      .gte("payment_date", thisMonthStart),

    // Last month contract payments (costs)
    supabase
      .from("contract_payments")
      .select("amount_paid_paise")
      .eq("organization_id", orgId)
      .eq("status", "paid")
      .gte("payment_date", lastMonthStart)
      .lte("payment_date", lastMonthEnd),

    // All sites (for occupancy denominator)
    supabase
      .from("sites")
      .select("id")
      .eq("organization_id", orgId)
      .is("deleted_at", null),

    // Booked sites (for occupancy numerator)
    supabase
      .from("sites")
      .select("id")
      .eq("organization_id", orgId)
      .eq("status", "booked")
      .is("deleted_at", null),

    // 12-month invoices for chart
    supabase
      .from("invoices")
      .select("invoice_date, total_paise")
      .eq("organization_id", orgId)
      .gte("invoice_date", twelveMonthsAgo)
      .is("deleted_at", null),

    // 12-month contract payments for chart
    supabase
      .from("contract_payments")
      .select("payment_date, amount_paid_paise")
      .eq("organization_id", orgId)
      .eq("status", "paid")
      .gte("payment_date", twelveMonthsAgo),

    // 6-month payments received (inflow)
    supabase
      .from("payments_received")
      .select("payment_date, amount_paise")
      .eq("organization_id", orgId)
      .gte("payment_date", sixMonthsAgo),

    // 6-month contract payments (outflow)
    supabase
      .from("contract_payments")
      .select("payment_date, amount_paid_paise")
      .eq("organization_id", orgId)
      .eq("status", "paid")
      .gte("payment_date", sixMonthsAgo),

    // Aging receivables
    supabase
      .from("invoices")
      .select("due_date, balance_due_paise")
      .eq("organization_id", orgId)
      .in("status", ["sent", "partially_paid", "overdue"])
      .is("deleted_at", null),

    // Payables due in next 30 days
    supabase
      .from("contract_payments")
      .select("amount_due_paise")
      .eq("organization_id", orgId)
      .eq("status", "upcoming")
      .lte("due_date", thirtyDaysFromNow),

    // Overdue payables
    supabase
      .from("contract_payments")
      .select("amount_due_paise")
      .eq("organization_id", orgId)
      .eq("status", "overdue"),

    // Campaign pipeline
    supabase
      .from("campaigns")
      .select("status, total_value_paise")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .in("status", ["enquiry", "proposal_sent", "confirmed", "live"]),

    // Revenue by site via campaign_sites
    supabase
      .from("campaign_sites")
      .select("site_id, display_rate_paise, campaign:campaigns(status)")
      .eq("organization_id", orgId),

    // Costs by site via contract_payments → contracts
    supabase
      .from("contract_payments")
      .select("amount_paid_paise, contract:contracts(site_id)")
      .eq("organization_id", orgId)
      .eq("status", "paid"),

    // Site names
    supabase
      .from("sites")
      .select("id, name, site_code")
      .eq("organization_id", orgId)
      .is("deleted_at", null),

    // Critical + warning alerts for this user
    supabase
      .from("alerts")
      .select(
        "id, organization_id, user_id, target_role, alert_type, title, message, severity, related_entity_type, related_entity_id, is_read, read_at, is_dismissed, scheduled_for, sent_email, sent_whatsapp, created_at"
      )
      .eq("organization_id", orgId)
      .in("severity", ["critical", "warning"])
      .eq("is_dismissed", false)
      .eq("is_read", false)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  // ── KPI calculations ───────────────────────────────────────────────────────

  const thisMonthRevenue = (thisMonthInvoices ?? []).reduce(
    (sum, r) => sum + (r.total_paise ?? 0),
    0
  );
  const lastMonthRevenue = (lastMonthInvoices ?? []).reduce(
    (sum, r) => sum + (r.total_paise ?? 0),
    0
  );
  const thisMonthCostTotal = (thisMonthCosts ?? []).reduce(
    (sum, r) => sum + (r.amount_paid_paise ?? 0),
    0
  );
  const lastMonthCostTotal = (lastMonthCosts ?? []).reduce(
    (sum, r) => sum + (r.amount_paid_paise ?? 0),
    0
  );

  const netProfit = thisMonthRevenue - thisMonthCostTotal;

  const revenueChange =
    lastMonthRevenue > 0
      ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
      : 0;

  const costChange =
    lastMonthCostTotal > 0
      ? ((thisMonthCostTotal - lastMonthCostTotal) / lastMonthCostTotal) * 100
      : 0;

  const profitMargin =
    thisMonthRevenue > 0 ? (netProfit / thisMonthRevenue) * 100 : 0;

  // Occupancy
  const totalSiteCount = (allSites ?? []).length;
  const bookedSiteCount = (bookedSites ?? []).length;

  // ── 12-month chart data ────────────────────────────────────────────────────

  const monthKeys12 = lastNMonthKeys(12);

  // Build revenue map: monthKey → total paise
  const revenueMap = new Map<string, number>();
  for (const row of (twelveMonthInvoices ?? []) as MonthlyInvoiceRow[]) {
    const key = monthKey(row.invoice_date);
    revenueMap.set(key, (revenueMap.get(key) ?? 0) + (row.total_paise ?? 0));
  }

  // Build costs map
  const costsMap = new Map<string, number>();
  for (const row of (twelveMonthCosts ?? []) as MonthlyCostRow[]) {
    if (!row.payment_date) continue;
    const key = monthKey(row.payment_date);
    costsMap.set(key, (costsMap.get(key) ?? 0) + (row.amount_paid_paise ?? 0));
  }

  const chartData = monthKeys12.map((month) => ({
    month,
    revenue: revenueMap.get(month) ?? 0,
    costs: costsMap.get(month) ?? 0,
  }));

  // ── 6-month cash flow data ─────────────────────────────────────────────────

  const monthKeys6 = lastNMonthKeys(6);

  const inflowMap = new Map<string, number>();
  for (const row of (sixMonthPayments ?? []) as MonthlyPaymentRow[]) {
    const key = monthKey(row.payment_date);
    inflowMap.set(key, (inflowMap.get(key) ?? 0) + (row.amount_paise ?? 0));
  }

  const outflowMap = new Map<string, number>();
  for (const row of (sixMonthOutflow ?? []) as MonthlyCostRow[]) {
    if (!row.payment_date) continue;
    const key = monthKey(row.payment_date);
    outflowMap.set(key, (outflowMap.get(key) ?? 0) + (row.amount_paid_paise ?? 0));
  }

  const cashFlowData = monthKeys6.map((month) => ({
    month,
    inflow: inflowMap.get(month) ?? 0,
    outflow: outflowMap.get(month) ?? 0,
  }));

  // ── Aging buckets ─────────────────────────────────────────────────────────

  let agingCurrent = 0;
  let aging31_60 = 0;
  let aging61_90 = 0;
  let aging90plus = 0;

  for (const row of (agingInvoices ?? []) as InvoiceAgingRow[]) {
    const daysOverdue = Math.floor(
      (now.getTime() - parseISO(row.due_date).getTime()) / (1000 * 60 * 60 * 24)
    );
    const amount = row.balance_due_paise ?? 0;

    if (daysOverdue <= 30) agingCurrent += amount;
    else if (daysOverdue <= 60) aging31_60 += amount;
    else if (daysOverdue <= 90) aging61_90 += amount;
    else aging90plus += amount;
  }

  const agingTotal = agingCurrent + aging31_60 + aging61_90 + aging90plus;

  // ── Payables ───────────────────────────────────────────────────────────────

  const payablesDueSoonTotal = (payablesDueSoon ?? []).reduce(
    (sum, r) => sum + (r.amount_due_paise ?? 0),
    0
  );
  const payablesOverdueTotal = (payablesOverdue ?? []).reduce(
    (sum, r) => sum + (r.amount_due_paise ?? 0),
    0
  );

  // ── Campaign pipeline ──────────────────────────────────────────────────────
  // Group by status, count and sum value

  type PipelineStatus = "enquiry" | "proposal_sent" | "confirmed" | "live";

  interface PipelineBucket {
    count: number;
    value: number;
  }

  const pipeline: Record<PipelineStatus, PipelineBucket> = {
    enquiry: { count: 0, value: 0 },
    proposal_sent: { count: 0, value: 0 },
    confirmed: { count: 0, value: 0 },
    live: { count: 0, value: 0 },
  };

  for (const row of (pipelineCampaigns ?? []) as CampaignPipelineRow[]) {
    const s = row.status as PipelineStatus;
    if (s in pipeline) {
      pipeline[s].count += 1;
      pipeline[s].value += row.total_value_paise ?? 0;
    }
  }

  // ── Top / Bottom sites ─────────────────────────────────────────────────────

  // Build per-site revenue map from campaign_sites where campaign is live/completed
  const siteRevenue = new Map<string, number>();
  for (const row of (revenueBySite ?? []) as unknown as CampaignSiteWithCampaign[]) {
    const campaignStatus = row.campaign?.status;
    // Only count revenue from active/completed campaigns
    if (campaignStatus === "live" || campaignStatus === "completed") {
      siteRevenue.set(
        row.site_id,
        (siteRevenue.get(row.site_id) ?? 0) + (row.display_rate_paise ?? 0)
      );
    }
  }

  // Build per-site cost map from contract_payments via contracts
  const siteCosts = new Map<string, number>();
  for (const row of (costsByContract ?? []) as unknown as ContractPaymentWithContract[]) {
    const siteId = row.contract?.site_id;
    if (siteId) {
      siteCosts.set(
        siteId,
        (siteCosts.get(siteId) ?? 0) + (row.amount_paid_paise ?? 0)
      );
    }
  }

  // Compute profit per site and sort
  interface SiteProfit {
    id: string;
    name: string;
    site_code: string;
    revenue: number;
    costs: number;
    profit: number;
  }

  const siteProfits: SiteProfit[] = ((siteRows ?? []) as SiteRow[]).map((s) => {
    const revenue = siteRevenue.get(s.id) ?? 0;
    const costs = siteCosts.get(s.id) ?? 0;
    return {
      id: s.id,
      name: s.name,
      site_code: s.site_code,
      revenue,
      costs,
      profit: revenue - costs,
    };
  });

  siteProfits.sort((a, b) => b.profit - a.profit);
  const top5Sites = siteProfits.slice(0, 5);
  const bottom5Sites = siteProfits.slice(-5).reverse();

  // ── Alerts ────────────────────────────────────────────────────────────────

  const criticalAlerts: Alert[] = (alertRows ?? []) as unknown as Alert[];

  // ── Render ────────────────────────────────────────────────────────────────

  const PIPELINE_LABELS: Record<PipelineStatus, string> = {
    enquiry: "Enquiry",
    proposal_sent: "Proposal Sent",
    confirmed: "Confirmed",
    live: "Live",
  };

  const PIPELINE_COLORS: Record<PipelineStatus, string> = {
    enquiry: "bg-muted text-foreground dark:bg-white/5 dark:text-muted-foreground",
    proposal_sent: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
    confirmed: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    live: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  };

  return (
    <div className="space-y-6">
      {/* ── Greeting + quick summary ─────────────────────────────────────── */}
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

      {/* ── Row 1: KPI cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          title={tDash("revenue_this_month")}
          value={inr(thisMonthRevenue)}
          changePercent={revenueChange}
          iconBg="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"
          icon={<DollarSign className="h-5 w-5" />}
          vsLabel={tDash("vsLastMonth")}
        />

        <KpiCard
          title={tDash("costs_this_month")}
          value={inr(thisMonthCostTotal)}
          changePercent={-costChange}
          iconBg="bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300"
          icon={<BarChart2 className="h-5 w-5" />}
          vsLabel={tDash("vsLastMonth")}
        />

        <KpiCard
          title={tDash("net_profit")}
          value={inr(netProfit)}
          changePercent={profitMargin}
          iconBg="bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"
          icon={<TrendingUp className="h-5 w-5" />}
          vsLabel={tDash("vsLastMonth")}
        />

        <OccupancyCard
          booked={bookedSiteCount}
          total={totalSiteCount}
          title={tDash("site_occupancy")}
          bookedLabel={tDash("of_sites_booked", { total: totalSiteCount })}
        />
      </div>

      {/* ── Row 2: Charts ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{tDash("revenue_vs_cost")}</CardTitle>
          </CardHeader>
          <CardContent>
            <RevenueCostChart data={chartData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{tDash("cash_flow")}</CardTitle>
          </CardHeader>
          <CardContent>
            <CashFlowChart data={cashFlowData} />
          </CardContent>
        </Card>
      </div>

      {/* ── Row 3: Receivables, Payables, Pipeline ───────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Receivables aging */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{tDash("outstanding_ar")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <AgingRow label="0–30 days" amount={agingCurrent} color="text-foreground" />
            <AgingRow label="31–60 days" amount={aging31_60} color="text-amber-600 dark:text-amber-400" />
            <AgingRow label="61–90 days" amount={aging61_90} color="text-orange-600 dark:text-orange-400" />
            <AgingRow label="90+ days" amount={aging90plus} color="text-rose-600 dark:text-rose-400" />
            <div className="border-t border-border pt-2 mt-1">
              <AgingRow label="Total" amount={agingTotal} color="font-semibold text-foreground" />
            </div>
          </CardContent>
        </Card>

        {/* Payables */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{tDash("outstanding_payables")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl bg-muted/40 p-4">
              <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Due in next 30 days</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                {inr(payablesDueSoonTotal)}
              </p>
            </div>
            <div className="rounded-xl bg-rose-50/70 dark:bg-rose-500/10 p-4 ring-1 ring-inset ring-rose-200/60 dark:ring-rose-500/20">
              <p className="text-[11px] uppercase tracking-wider font-semibold text-rose-700/80 dark:text-rose-300/80">Overdue</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-rose-700 dark:text-rose-300">
                {inr(payablesOverdueTotal)}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Campaign pipeline */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{tDash("campaign_pipeline")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(["enquiry", "proposal_sent", "confirmed", "live"] as PipelineStatus[]).map(
              (s) => (
                <div key={s} className="flex items-center justify-between gap-2">
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${PIPELINE_COLORS[s]}`}
                  >
                    {PIPELINE_LABELS[s]}
                  </span>
                  <span className="text-sm text-foreground tabular-nums">
                    {pipeline[s].count}
                    <span className="mx-1.5 text-muted-foreground/50">•</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {inr(pipeline[s].value)}
                    </span>
                  </span>
                </div>
              )
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Row 4: Top / Bottom sites ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{tDash("top_sites")}</CardTitle>
          </CardHeader>
          <CardContent>
            <SiteTable
              sites={top5Sites}
              labels={{
                site: tDash("site"),
                revenue: tDash("revenue"),
                costs: tDash("costs"),
                profit: tDash("profit"),
                noData: tDash("no_data"),
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{tDash("bottom_sites")}</CardTitle>
          </CardHeader>
          <CardContent>
            <SiteTable
              sites={bottom5Sites}
              isBottom
              labels={{
                site: tDash("site"),
                revenue: tDash("revenue"),
                costs: tDash("costs"),
                profit: tDash("profit"),
                noData: tDash("no_data"),
              }}
            />
          </CardContent>
        </Card>
      </div>

      {/* ── Row 5: Alerts ─────────────────────────────────────────────────── */}
      <DashboardAlerts alerts={criticalAlerts} locale={locale} />
    </div>
  );
}

// ─── AgingRow sub-component ───────────────────────────────────────────────────

function AgingRow({
  label,
  amount,
  color,
}: {
  label: string;
  amount: number;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${color}`}>
        {new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: "INR",
          maximumFractionDigits: 0,
        }).format(amount / 100)}
      </span>
    </div>
  );
}

// ─── SiteTable sub-component ──────────────────────────────────────────────────

interface SiteProfitRow {
  id: string;
  name: string;
  site_code: string;
  revenue: number;
  costs: number;
  profit: number;
}

function SiteTable({
  sites,
  isBottom = false,
  labels = { site: "Site", revenue: "Revenue", costs: "Costs", profit: "Profit", noData: "No data yet" },
}: {
  sites: SiteProfitRow[];
  isBottom?: boolean;
  labels?: { site: string; revenue: string; costs: string; profit: string; noData: string };
}) {
  const fmt = (p: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(p / 100);

  if (sites.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">{labels.noData}</p>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
          <th className="text-left pb-2 font-semibold">{labels.site}</th>
          <th className="text-right pb-2 font-semibold">{labels.revenue}</th>
          <th className="text-right pb-2 font-semibold">{labels.costs}</th>
          <th className="text-right pb-2 font-semibold">{labels.profit}</th>
        </tr>
      </thead>
      <tbody>
        {sites.map((s) => (
          <tr key={s.id} className="border-b border-border last:border-0">
            <td className="py-3 pr-2">
              <p className="font-medium text-foreground truncate max-w-[140px]">
                {s.name}
              </p>
              <p className="text-[11px] text-muted-foreground">{s.site_code}</p>
            </td>
            <td className="py-3 text-right tabular-nums text-muted-foreground">{fmt(s.revenue)}</td>
            <td className="py-3 text-right tabular-nums text-muted-foreground">{fmt(s.costs)}</td>
            <td
              className={`py-3 text-right font-semibold tabular-nums ${
                isBottom || s.profit < 0
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {fmt(s.profit)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── RoleSpecificDashboard ────────────────────────────────────────────────────
// Shown to non-admin roles.  Each role sees only what's relevant to their job.

async function RoleSpecificDashboard({
  role,
  orgId,
  locale: _locale,
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

  const greeting = profile.full_name ? `Welcome back, ${profile.full_name}` : "Welcome back";

  // ── executive (sales + operations combined) ───────────────────────────────
  // Executives do both sales (pipeline, proposals) AND operations (mountings,
  // site upkeep), so we show both sets of stats on one dashboard.

  // Managers see the same dashboard as executives — they handle the same
  // sales + operations work (plus accounts, which surfaces separately in
  // /billing). Keeping a single branch avoids duplicating ~80 lines of
  // Supabase queries and stat cards.
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
      0
    );

    return (
      <RoleWrapper greeting={greeting} role={role === "manager" ? "Manager" : "Executive"}>
        {/* Sales / pipeline */}
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
          <SimpleStatCard
            label="Available Sites"
            value={String((availableSites ?? []).length)}
          />
        </div>
        {/* Operations / mounting */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
          <SimpleStatCard label="Mountings Today" value={String((todayMountings ?? []).length)} />
          <SimpleStatCard label="Mountings This Week" value={String((weekMountings ?? []).length)} />
          <SimpleStatCard label="Sites Under Maintenance" value={String((maintenanceSites ?? []).length)} />
        </div>
      </RoleWrapper>
    );
  }

  // ── accounts ─────────────────────────────────────────────────────────────

  if (role === "accounts") {
    const [
      { data: overdueInvoices },
      { data: payablesDue },
    ] = await Promise.all([
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
      0
    );
    const overdueCount = (overdueInvoices ?? []).filter((i) => {
      const daysOverdue = Math.floor(
        (now.getTime() - parseISO(i.due_date).getTime()) / (1000 * 60 * 60 * 24)
      );
      return daysOverdue > 0;
    }).length;
    const totalPayable = (payablesDue ?? []).reduce(
      (s, p) => s + (p.amount_due_paise ?? 0),
      0
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

  // ── viewer (and fallback) ─────────────────────────────────────────────────

  const [
    { data: sitesAll },
    { data: campaignsLive },
  ] = await Promise.all([
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

// ─── RoleWrapper ──────────────────────────────────────────────────────────────

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

// ─── SimpleStatCard ───────────────────────────────────────────────────────────

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
