// Site analytics — server-renderable block that shows KPI cards + a tiny
// bar chart of revenue vs cost over the last 12 months.
//
// Accepts the already-computed `SiteAnalytics` payload so the detail page
// owns the data fetch. No client interactivity needed — pure SVG bars keep
// the bundle lean and match the rest of the detail page's static feel.

import { inr } from "@/lib/utils";
import type { SiteAnalytics } from "@/lib/analytics/site-analytics";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  BarChart3,
  Calendar,
  Megaphone,
  Clock,
} from "lucide-react";

interface Props {
  analytics: SiteAnalytics;
}

export function SiteAnalyticsPanel({ analytics }: Props) {
  const {
    revenue_paise,
    cost_paise,
    profit_paise,
    margin_pct,
    occupancy_pct,
    booked_days,
    total_days,
    campaign_count,
    pending_expenses_paise,
    pending_expense_count,
    last_12_months,
    rent_cost_paise,
    expense_cost_paise,
  } = analytics;

  const profitIsPositive = profit_paise >= 0;

  return (
    <div className="space-y-4">
      {/* Row 1 — primary KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi
          icon={<Wallet className="h-4 w-4" />}
          label="Revenue (1Y)"
          value={inr(revenue_paise)}
          tone="info"
        />
        <Kpi
          icon={<BarChart3 className="h-4 w-4" />}
          label="Cost (1Y)"
          value={inr(cost_paise)}
          sub={`Rent ${inr(rent_cost_paise)} · Exp ${inr(expense_cost_paise)}`}
          tone="neutral"
        />
        <Kpi
          icon={
            profitIsPositive ? (
              <TrendingUp className="h-4 w-4" />
            ) : (
              <TrendingDown className="h-4 w-4" />
            )
          }
          label="Profit"
          value={inr(profit_paise)}
          sub={
            margin_pct !== null ? `${margin_pct.toFixed(1)}% margin` : "No revenue yet"
          }
          tone={profitIsPositive ? "success" : "danger"}
        />
        <Kpi
          icon={<Calendar className="h-4 w-4" />}
          label="Occupancy"
          value={`${occupancy_pct.toFixed(1)}%`}
          sub={`${booked_days}/${total_days} days`}
          tone="accent"
        />
      </div>

      {/* Row 2 — secondary KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi
          icon={<Megaphone className="h-4 w-4" />}
          label="Campaigns"
          value={String(campaign_count)}
          sub="distinct bookings this year"
          tone="info"
        />
        <Kpi
          icon={<Clock className="h-4 w-4" />}
          label="Pending expenses"
          value={inr(pending_expenses_paise)}
          sub={
            pending_expense_count === 0
              ? "All settled"
              : `${pending_expense_count} open ${
                  pending_expense_count === 1 ? "request" : "requests"
                }`
          }
          tone={pending_expense_count > 0 ? "warning" : "neutral"}
        />
        <Kpi
          icon={<BarChart3 className="h-4 w-4" />}
          label="Window"
          value={`${total_days} days`}
          sub="Last 12 months"
          tone="neutral"
        />
      </div>

      {/* Row 3 — 12-month revenue vs cost chart */}
      <div className="rounded-xl border border-border bg-muted/20 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Revenue vs Cost · last 12 months
          </h4>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <LegendDot className="bg-indigo-500" /> Revenue
            <LegendDot className="bg-rose-500" /> Cost
          </div>
        </div>
        <MonthlyBars data={last_12_months} />
      </div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone: "success" | "danger" | "warning" | "info" | "neutral" | "accent";
}) {
  const toneBg: Record<
    "success" | "danger" | "warning" | "info" | "neutral" | "accent",
    string
  > = {
    success: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
    danger: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
    warning: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
    info: "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
    accent: "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300",
    neutral: "bg-muted text-foreground",
  };
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${toneBg[tone]}`}
        >
          {icon}
        </span>
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="mt-2 text-lg font-semibold tabular-nums text-foreground">
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
      )}
    </div>
  );
}

function LegendDot({ className }: { className: string }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${className}`}
      aria-hidden
    />
  );
}

function MonthlyBars({
  data,
}: {
  data: { month: string; revenue_paise: number; cost_paise: number }[];
}) {
  const max = Math.max(
    1,
    ...data.map((d) => Math.max(d.revenue_paise, d.cost_paise)),
  );

  // All-zero window — show a gentle empty state rather than flat baseline.
  if (max <= 1) {
    return (
      <p className="py-8 text-center text-xs text-muted-foreground">
        No revenue or cost recorded in the last 12 months.
      </p>
    );
  }

  return (
    <div className="flex items-end justify-between gap-1 h-32">
      {data.map((d) => {
        const revPct = (d.revenue_paise / max) * 100;
        const costPct = (d.cost_paise / max) * 100;
        // Month label — "Apr" from "2026-04"
        const monthShort = monthLabel(d.month);
        return (
          <div
            key={d.month}
            className="group relative flex flex-1 flex-col items-center justify-end"
            title={`${d.month} — Revenue ${formatShort(d.revenue_paise)}, Cost ${formatShort(d.cost_paise)}`}
          >
            <div className="flex h-full w-full items-end justify-center gap-0.5">
              <div
                className="w-2 rounded-t-sm bg-indigo-500/80 transition-all group-hover:bg-indigo-500"
                style={{ height: `${Math.max(2, revPct)}%` }}
              />
              <div
                className="w-2 rounded-t-sm bg-rose-500/70 transition-all group-hover:bg-rose-500"
                style={{ height: `${Math.max(2, costPct)}%` }}
              />
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {monthShort}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function monthLabel(ym: string): string {
  // ym is "YYYY-MM"
  const [, m] = ym.split("-");
  const idx = Math.max(1, Math.min(12, parseInt(m, 10))) - 1;
  return [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ][idx];
}

// Rupee short format: ₹12.3L / ₹1.2Cr / ₹4.5K. Mirrors tooltips only; cards
// still use full inr() for precision.
function formatShort(paise: number): string {
  const rupees = paise / 100;
  const abs = Math.abs(rupees);
  if (abs >= 1_00_00_000) return `₹${(rupees / 1_00_00_000).toFixed(1)}Cr`;
  if (abs >= 1_00_000) return `₹${(rupees / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `₹${(rupees / 1_000).toFixed(1)}K`;
  return `₹${Math.round(rupees)}`;
}
