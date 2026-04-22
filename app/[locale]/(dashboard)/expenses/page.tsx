// Org-wide payment-requests / site-expenses list.
// Users from any role can view. Only finance roles can approve / mark paid /
// reject — handled inside ExpensesList based on the `canSettle` prop.
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";
import { ExpensesList, type ExpenseRow } from "@/components/expenses/ExpensesList";
import { NewExpenseDialog } from "@/components/expenses/NewExpenseDialog";
import { inr, sanitizeSearch } from "@/lib/utils";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
} from "@/lib/constants/expenses";
import type { UserRole } from "@/lib/types/database";

export const metadata = { title: "Payment requests" };

const FINANCE_ROLES: UserRole[] = ["super_admin", "admin", "manager", "accounts"];

export default async function ExpensesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    q?: string;
    status?: string;
    category?: string;
    site?: string;
  }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { q, status, category, site } = await searchParams;

  const supabase = await createClient();

  // ── Caller's role (for gating settle actions in the UI) ──────────────────
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

  // ── Sites for the "New request" dropdown + filter ────────────────────────
  const { data: sitesData } = await supabase
    .from("sites")
    .select("id, name, site_code")
    .is("deleted_at", null)
    .order("name")
    .limit(500);
  const sites = (sitesData ?? []) as { id: string; name: string; site_code: string | null }[];

  // ── Expenses query (filters + site join) ─────────────────────────────────
  let query = supabase
    .from("site_expenses")
    .select(
      `id, category, description, amount_paise, status, payee_name, payee_type,
       needed_by, paid_at, payment_mode, receipt_doc_urls, payment_proof_urls,
       created_at, site_id,
       site:sites(id, name, site_code)`,
      { count: "exact" },
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);

  if (status && EXPENSE_STATUSES.some((s) => s.value === status)) {
    query = query.eq("status", status);
  }
  if (category && EXPENSE_CATEGORIES.some((c) => c.value === category)) {
    query = query.eq("category", category);
  }
  if (site) {
    query = query.eq("site_id", site);
  }
  if (q) {
    const safe = sanitizeSearch(q);
    query = query.or(
      `description.ilike.%${safe}%,payee_name.ilike.%${safe}%`,
    );
  }

  const { data, error } = await query;

  // Supabase types the `site` relation as an array; collapse it to a single obj.
  const expenses: ExpenseRow[] = ((data ?? []) as unknown as Array<
    Omit<ExpenseRow, "site"> & {
      site: ExpenseRow["site"] | ExpenseRow["site"][] | null;
    }
  >).map((r) => ({
    ...r,
    site: Array.isArray(r.site) ? r.site[0] ?? null : r.site ?? null,
  }));

  // ── KPI totals (over current filtered view) ──────────────────────────────
  const totals = expenses.reduce(
    (acc, e) => {
      if (e.status === "paid") acc.paid += e.amount_paise;
      else if (e.status === "rejected") acc.rejected += e.amount_paise;
      else acc.outstanding += e.amount_paise;
      return acc;
    },
    { outstanding: 0, paid: 0, rejected: 0 },
  );

  const hasFilters = !!(q || status || category || site);

  return (
    <div>
      <PageHeader
        eyebrow="Accounts"
        title="Payment requests"
        description="Create and settle payments for site expenses — electricity, rent, cleaning, and more."
        actions={
          <NewExpenseDialog sites={sites} triggerLabel="New request" />
        }
      />

      {/* KPI strip */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label="Outstanding"
          value={inr(totals.outstanding)}
          tone="warning"
        />
        <KpiCard label="Paid" value={inr(totals.paid)} tone="success" />
        <KpiCard
          label="Rejected"
          value={inr(totals.rejected)}
          tone="neutral"
        />
      </div>

      {/* Filters */}
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
        <select
          name="status"
          defaultValue={status ?? ""}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {EXPENSE_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          name="category"
          defaultValue={category ?? ""}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">All categories</option>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
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
          <Link href="/expenses">
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
        <ExpensesList
          expenses={expenses}
          canSettle={canSettle}
          emptyMessage={
            hasFilters
              ? "No requests match those filters."
              : "No payment requests yet."
          }
        />
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
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
          current view
        </Badge>
      </div>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${toneClass}`}>
        {value}
      </p>
    </div>
  );
}
