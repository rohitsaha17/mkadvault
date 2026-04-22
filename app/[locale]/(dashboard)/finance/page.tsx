// Finance overview — KPIs across the whole org. Cash flow at a glance.
//
//   - Outstanding    = sum of amount on pending + approved requests
//   - Paid this month= sum of amount on paid requests where paid_at in current month
//   - Pending review = count of status='pending' (what approvers should act on)
//   - By category    = breakdown of this month's paid amounts
//
// Keeps the math simple and pulls from `site_expenses` directly — no
// extra tables needed. Month boundaries are computed server-side in UTC
// because that's how `paid_at` is stored.
import { setRequestLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  TrendingUp,
  Wallet,
  CheckCheck,
  Hourglass,
  ArrowRight,
} from "lucide-react";
import { inr } from "@/lib/utils";
import { expenseCategoryLabel } from "@/lib/constants/expenses";
import type { ExpenseCategory, ExpenseStatus } from "@/lib/types/database";

export const metadata = { title: "Finance" };

export default async function FinanceOverviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();

  // ── Current month boundaries (UTC) ────────────────────────────────────────
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  // ── Pull a broad cut once and bucket client-side. RLS scopes to org. ─────
  const { data } = await supabase
    .from("site_expenses")
    .select("amount_paise, status, category, paid_at, needed_by")
    .is("deleted_at", null)
    .limit(2000);

  type Row = {
    amount_paise: number;
    status: ExpenseStatus;
    category: ExpenseCategory;
    paid_at: string | null;
    needed_by: string | null;
  };
  const rows = (data ?? []) as Row[];

  let outstanding = 0;
  let paidThisMonth = 0;
  let pendingCount = 0;
  let approvedCount = 0;
  let overdueCount = 0;
  const byCategory = new Map<string, number>();
  const today = now.toISOString().slice(0, 10);

  for (const r of rows) {
    if (r.status === "pending") {
      outstanding += r.amount_paise;
      pendingCount += 1;
      if (r.needed_by && r.needed_by < today) overdueCount += 1;
    } else if (r.status === "approved") {
      outstanding += r.amount_paise;
      approvedCount += 1;
      if (r.needed_by && r.needed_by < today) overdueCount += 1;
    } else if (r.status === "paid" && r.paid_at && r.paid_at >= monthStart) {
      paidThisMonth += r.amount_paise;
      const cat = expenseCategoryLabel(r.category);
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + r.amount_paise);
    }
  }

  const sortedCategories = Array.from(byCategory.entries()).sort(
    (a, b) => b[1] - a[1],
  );
  const catTotal = sortedCategories.reduce((a, [, v]) => a + v, 0);

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title="Overview"
        description="Track outstanding payment requests, settled payments, and category-wise spend."
      />

      {/* KPI cards */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Outstanding"
          value={inr(outstanding)}
          hint={`${pendingCount + approvedCount} open`}
          icon={<Wallet className="h-4 w-4" />}
          tone="warning"
        />
        <KpiCard
          label="Paid this month"
          value={inr(paidThisMonth)}
          hint={`since ${new Date(monthStart).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
          })}`}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="success"
        />
        <KpiCard
          label="Awaiting approval"
          value={String(pendingCount)}
          hint={overdueCount > 0 ? `${overdueCount} past needed-by` : "on time"}
          icon={<Hourglass className="h-4 w-4" />}
          tone={pendingCount > 0 ? "warning" : "neutral"}
        />
        <KpiCard
          label="Approved, unpaid"
          value={String(approvedCount)}
          hint="ready to settle"
          icon={<CheckCheck className="h-4 w-4" />}
          tone="neutral"
        />
      </div>

      {/* Category breakdown + quick jump panels */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card card-elevated p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">
              Spend this month by category
            </h3>
            <Badge variant="outline" className="text-[10px]">
              Paid only
            </Badge>
          </div>
          {sortedCategories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No payments settled yet this month.
            </p>
          ) : (
            <ul className="space-y-2">
              {sortedCategories.slice(0, 8).map(([cat, amt]) => {
                const pct = catTotal > 0 ? (amt / catTotal) * 100 : 0;
                return (
                  <li key={cat}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{cat}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {inr(amt)}{" "}
                        <span className="text-[10px]">({pct.toFixed(0)}%)</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="space-y-3">
          <QuickLink
            href="/finance/requests"
            title="All payment requests"
            subtitle="Browse, filter, create new"
          />
          <QuickLink
            href="/finance/approvals"
            title="Approvals queue"
            subtitle={
              pendingCount === 0
                ? "Nothing waiting"
                : `${pendingCount} pending review`
            }
            badge={pendingCount > 0 ? String(pendingCount) : undefined}
            badgeTone={pendingCount > 0 ? "warning" : undefined}
          />
          <QuickLink
            href="/finance/payments"
            title="Payment history"
            subtitle="Settled requests with proofs"
          />
          <QuickLink
            href="/finance/receipts"
            title="Receipts vault"
            subtitle="Bills and payment proofs"
          />
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  tone: "success" | "warning" | "neutral";
}) {
  const toneClass =
    tone === "success"
      ? "text-emerald-700 dark:text-emerald-300"
      : tone === "warning"
      ? "text-amber-700 dark:text-amber-300"
      : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card card-elevated p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <span className="rounded-md bg-muted p-1.5 text-muted-foreground">
          {icon}
        </span>
      </div>
      <p className={`text-2xl font-semibold tabular-nums ${toneClass}`}>
        {value}
      </p>
      {hint && (
        <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

function QuickLink({
  href,
  title,
  subtitle,
  badge,
  badgeTone,
}: {
  href: string;
  title: string;
  subtitle: string;
  badge?: string;
  badgeTone?: "warning";
}) {
  return (
    <Link href={href}>
      <Button
        variant="outline"
        className="h-auto w-full justify-between px-4 py-3 text-left hover:bg-muted/50"
      >
        <span className="flex flex-col">
          <span className="text-sm font-medium text-foreground">
            {title}
            {badge && (
              <span
                className={`ml-2 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                  badgeTone === "warning"
                    ? "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {badge}
              </span>
            )}
          </span>
          <span className="text-[11px] text-muted-foreground">{subtitle}</span>
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Button>
    </Link>
  );
}
