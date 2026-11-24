// Payments history — every request that's been marked PAID. Lets
// finance roles find past payments quickly (by payee, date range, site)
// and confirms the payment proof is attached.
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";
import {
  ExpensesList,
  type ExpenseRow,
} from "@/components/expenses/ExpensesList";
import { inr, sanitizeSearch } from "@/lib/utils";
import type { UserRole } from "@/lib/types/database";

export const metadata = { title: "Payment history" };

const FINANCE_ROLES: UserRole[] = [
  "super_admin",
  "admin",
  "manager",
  "accounts",
];

const PAGE_SIZE = 50;

export default async function FinancePaymentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    q?: string;
    from?: string;
    to?: string;
    site?: string;
    page?: string;
  }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { q, from, to, site, page } = await searchParams;
  const currentPage = Math.max(1, parseInt(page ?? "1", 10));
  const rangeFrom = (currentPage - 1) * PAGE_SIZE;
  const rangeTo = rangeFrom + PAGE_SIZE - 1;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("role, roles")
        .eq("id", user.id)
        .single()
    : { data: null };

  const rolesArr: UserRole[] =
    Array.isArray(profile?.roles) && profile!.roles!.length > 0
      ? (profile!.roles as UserRole[])
      : profile?.role
      ? [profile.role as UserRole]
      : [];
  const canSettle = rolesArr.some((r) => FINANCE_ROLES.includes(r));

  const { data: sitesData } = await supabase
    .from("sites")
    .select("id, name, site_code")
    .is("deleted_at", null)
    .order("name")
    .limit(200);
  const sites = (sitesData ?? []) as {
    id: string;
    name: string;
    site_code: string | null;
  }[];

  // Two parallel queries with identical filters:
  //   A. the paged row set the table renders (50 at a time);
  //   B. the aggregate pull for the KPI cards — same filters, no
  //      pagination, just amount_paise + payment_proof_urls, so the
  //      "Total paid", "Transactions", and "Missing proof" cards tally
  //      ALL matching rows, not only the 50 visible ones.
  let pagedQuery = supabase
    .from("site_expenses")
    .select(
      `id, category, description, amount_paise, status, payee_name, payee_type,
       needed_by, paid_at, payment_mode, receipt_doc_urls, payment_proof_urls,
       created_at, site_id,
       site:sites(id, name, site_code)`,
      { count: "exact" },
    )
    .is("deleted_at", null)
    .eq("status", "paid")
    .order("paid_at", { ascending: false })
    .range(rangeFrom, rangeTo);
  let aggQuery = supabase
    .from("site_expenses")
    .select("amount_paise, payment_proof_urls")
    .is("deleted_at", null)
    .eq("status", "paid");

  if (from) {
    pagedQuery = pagedQuery.gte("paid_at", `${from}T00:00:00Z`);
    aggQuery = aggQuery.gte("paid_at", `${from}T00:00:00Z`);
  }
  if (to) {
    pagedQuery = pagedQuery.lte("paid_at", `${to}T23:59:59Z`);
    aggQuery = aggQuery.lte("paid_at", `${to}T23:59:59Z`);
  }
  if (site) {
    pagedQuery = pagedQuery.eq("site_id", site);
    aggQuery = aggQuery.eq("site_id", site);
  }
  if (q) {
    const safe = sanitizeSearch(q);
    const orClause = `description.ilike.%${safe}%,payee_name.ilike.%${safe}%`;
    pagedQuery = pagedQuery.or(orClause);
    aggQuery = aggQuery.or(orClause);
  }

  const [pagedRes, aggRes] = await Promise.all([pagedQuery, aggQuery]);
  const { data, error, count: totalCount } = pagedRes;
  const aggRows = (aggRes.data ?? []) as Array<{
    amount_paise: number | null;
    payment_proof_urls: string[] | null;
  }>;

  const expenses: ExpenseRow[] = ((data ?? []) as unknown as Array<
    Omit<ExpenseRow, "site"> & {
      site: ExpenseRow["site"] | ExpenseRow["site"][] | null;
    }
  >).map((r) => ({
    ...r,
    site: Array.isArray(r.site) ? r.site[0] ?? null : r.site ?? null,
  }));

  // Totals over the WHOLE filter match, not the 50 visible rows.
  const total = aggRows.reduce((a, r) => a + (r.amount_paise ?? 0), 0);
  const transactionCount = totalCount ?? aggRows.length;
  const missingProof = aggRows.filter(
    (r) => (r.payment_proof_urls?.length ?? 0) === 0,
  ).length;

  const hasFilters = !!(q || from || to || site);
  const totalPages = Math.max(1, Math.ceil(transactionCount / PAGE_SIZE));
  const rangeStart = transactionCount === 0 ? 0 : rangeFrom + 1;
  const rangeEnd = Math.min(rangeFrom + expenses.length, transactionCount);
  const buildPageHref = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (from) u.set("from", from);
    if (to) u.set("to", to);
    if (site) u.set("site", site);
    if (p > 1) u.set("page", String(p));
    const qs = u.toString();
    return qs ? `/finance/payments?${qs}` : `/finance/payments`;
  };

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title="Payment history"
        description="All payments that have been settled — with modes, references, and attached proofs."
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Total paid"
          value={inr(total)}
          badge={hasFilters ? "matching filters" : "all paid"}
          tone="success"
        />
        <StatCard
          label="Transactions"
          value={String(transactionCount)}
          badge={hasFilters ? "matching filters" : "all paid"}
          tone="neutral"
        />
        <StatCard
          label="Missing proof"
          value={String(missingProof)}
          badge={missingProof > 0 ? "attach receipts" : "all documented"}
          tone={missingProof > 0 ? "warning" : "success"}
        />
      </div>

      <form method="GET" className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search description or payee…"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-muted-foreground">From</span>
          <Input
            type="date"
            name="from"
            defaultValue={from ?? ""}
            className="w-40"
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-muted-foreground">To</span>
          <Input
            type="date"
            name="to"
            defaultValue={to ?? ""}
            className="w-40"
          />
        </div>
        <select
          name="site"
          defaultValue={site ?? ""}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm max-w-[12rem]"
        >
          <option value="">All sites</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" size="sm">
          Apply
        </Button>
        {hasFilters && (
          <Link href="/finance/payments">
            <Button variant="ghost" size="sm">
              Clear
            </Button>
          </Link>
        )}
      </form>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          Failed to load: {error.message}
        </div>
      )}

      {!error && (
        <>
          <ExpensesList
            expenses={expenses}
            canSettle={canSettle}
            emptyMessage={
              hasFilters
                ? "No payments match those filters."
                : "No payments settled yet."
            }
          />
          {transactionCount > 0 && (
            <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
              <p className="tabular-nums">
                Showing <span className="font-medium text-foreground">{rangeStart}–{rangeEnd}</span> of{" "}
                <span className="font-medium text-foreground">{transactionCount}</span>
              </p>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  {currentPage > 1 ? (
                    <Link href={buildPageHref(currentPage - 1)}>
                      <Button variant="outline" size="sm">← Previous</Button>
                    </Link>
                  ) : (
                    <Button variant="outline" size="sm" disabled>← Previous</Button>
                  )}
                  <span className="tabular-nums">
                    Page {currentPage} of {totalPages}
                  </span>
                  {currentPage < totalPages ? (
                    <Link href={buildPageHref(currentPage + 1)}>
                      <Button variant="outline" size="sm">Next →</Button>
                    </Link>
                  ) : (
                    <Button variant="outline" size="sm" disabled>Next →</Button>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  badge,
  tone,
}: {
  label: string;
  value: string;
  badge: string;
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
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <Badge variant="outline" className="text-[10px]">
          {badge}
        </Badge>
      </div>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${toneClass}`}>
        {value}
      </p>
    </div>
  );
}
