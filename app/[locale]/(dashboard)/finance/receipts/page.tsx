// Receipts vault — a flat browser of every receipt and payment-proof
// document attached to any payment request in the org. Useful when
// you're digging up a specific bill for a tax return or audit and don't
// remember which request it was attached to.
//
// Two "kinds" are surfaced:
//   * receipt  — the bill/invoice attached by the requester (e.g. DISCOM
//                 bill, electrician's bill). Stored in receipt_doc_urls.
//   * proof    — the payment proof attached by finance when marking a
//                 request paid (UPI screenshot, NEFT confirmation).
//                 Stored in payment_proof_urls.
//
// Each row shows signed download URLs so the user can open the doc
// directly. Signed URLs are short-lived (1 hour).
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/EmptyState";
import { FileText, Receipt, BadgeCheck, Search, ExternalLink } from "lucide-react";
import { inr, fmt, sanitizeSearch } from "@/lib/utils";
import { expenseCategoryLabel } from "@/lib/constants/expenses";
import type { ExpenseCategory, ExpenseStatus } from "@/lib/types/database";

export const metadata = { title: "Receipts" };

// Signed URLs live for 1 hour — enough to click through several and
// still never leak the underlying path to an unauthenticated visitor.
const SIGNED_URL_TTL = 60 * 60;

interface DocRow {
  url: string;
  filename: string;
  kind: "receipt" | "proof";
  expenseId: string;
  description: string;
  payeeName: string;
  amountPaise: number;
  status: ExpenseStatus;
  category: ExpenseCategory;
  siteName: string | null;
  paidAt: string | null;
  createdAt: string;
}

function lastSegment(path: string): string {
  // Stored path looks like org/uid/receipts/1700000000_filename.pdf.
  // Strip the timestamp prefix if present so the filename is readable.
  const base = path.split("/").pop() ?? path;
  const underscore = base.indexOf("_");
  if (underscore > 0 && /^\d+$/.test(base.slice(0, underscore))) {
    return base.slice(underscore + 1);
  }
  return base;
}

export default async function FinanceReceiptsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ kind?: string; q?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { kind, q } = await searchParams;
  const kindFilter: "all" | "receipt" | "proof" =
    kind === "receipt" || kind === "proof" ? kind : "all";

  const supabase = await createClient();

  // Pull expenses that actually have at least one doc attached.
  // (The `or` filter uses `gt` on array_length via the Postgrest
  // `cs`/`not.is.null` can't express "array non-empty" cleanly, so we
  // fetch a reasonable page and filter client-side.)
  const { data, error } = await supabase
    .from("site_expenses")
    .select(
      `id, description, amount_paise, status, category, payee_name, paid_at,
       created_at, receipt_doc_urls, payment_proof_urls,
       site:sites(id, name, site_code)`,
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(500);

  // Flatten every doc into its own row so we can list them uniformly.
  const expenses = (data ?? []) as unknown as Array<{
    id: string;
    description: string;
    amount_paise: number;
    status: ExpenseStatus;
    category: ExpenseCategory;
    payee_name: string;
    paid_at: string | null;
    created_at: string;
    receipt_doc_urls: string[] | null;
    payment_proof_urls: string[] | null;
    site:
      | { id: string; name: string; site_code: string | null }
      | Array<{ id: string; name: string; site_code: string | null }>
      | null;
  }>;

  const admin = createAdminClient();
  const rows: DocRow[] = [];
  // Collect all paths first so we can sign them in one round-trip per kind.
  const flat: {
    path: string;
    kind: "receipt" | "proof";
    expense: (typeof expenses)[number];
  }[] = [];
  for (const e of expenses) {
    for (const p of e.receipt_doc_urls ?? []) {
      flat.push({ path: p, kind: "receipt", expense: e });
    }
    for (const p of e.payment_proof_urls ?? []) {
      flat.push({ path: p, kind: "proof", expense: e });
    }
  }

  // Bulk-sign URLs. `createSignedUrls` is much faster than N individual
  // `createSignedUrl` calls (one round-trip instead of N).
  if (flat.length > 0) {
    const paths = flat.map((f) => f.path);
    const { data: signed } = await admin.storage
      .from("expense-docs")
      .createSignedUrls(paths, SIGNED_URL_TTL);
    const byPath = new Map<string, string>();
    for (const s of signed ?? []) {
      if (s.signedUrl && s.path) byPath.set(s.path, s.signedUrl);
    }
    for (const f of flat) {
      const url = byPath.get(f.path);
      if (!url) continue;
      const site = Array.isArray(f.expense.site)
        ? f.expense.site[0] ?? null
        : f.expense.site ?? null;
      rows.push({
        url,
        filename: lastSegment(f.path),
        kind: f.kind,
        expenseId: f.expense.id,
        description: f.expense.description,
        payeeName: f.expense.payee_name,
        amountPaise: f.expense.amount_paise,
        status: f.expense.status,
        category: f.expense.category,
        siteName: site?.name ?? null,
        paidAt: f.expense.paid_at,
        createdAt: f.expense.created_at,
      });
    }
  }

  // Apply client-side filters (kind + free-text search on filename/payee/description).
  const filtered = rows.filter((r) => {
    if (kindFilter !== "all" && r.kind !== kindFilter) return false;
    if (q) {
      const safe = sanitizeSearch(q).toLowerCase();
      const hay = [r.filename, r.payeeName, r.description].join(" ").toLowerCase();
      if (!hay.includes(safe)) return false;
    }
    return true;
  });

  const totalReceipts = rows.filter((r) => r.kind === "receipt").length;
  const totalProofs = rows.filter((r) => r.kind === "proof").length;
  const hasFilters = kindFilter !== "all" || !!q;

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title="Receipts vault"
        description="Every bill and payment proof attached to a payment request, in one searchable place."
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Total documents"
          value={String(rows.length)}
          badge="in vault"
          icon={<FileText className="h-4 w-4" />}
        />
        <StatCard
          label="Bills / receipts"
          value={String(totalReceipts)}
          badge="from requesters"
          icon={<Receipt className="h-4 w-4" />}
        />
        <StatCard
          label="Payment proofs"
          value={String(totalProofs)}
          badge="from finance"
          icon={<BadgeCheck className="h-4 w-4" />}
        />
      </div>

      <form method="GET" className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search file name, payee, description…"
            className="pl-9"
          />
        </div>
        <select
          name="kind"
          defaultValue={kindFilter}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="all">All documents</option>
          <option value="receipt">Bills / receipts</option>
          <option value="proof">Payment proofs</option>
        </select>
        <Button type="submit" variant="outline" size="sm">
          Apply
        </Button>
        {hasFilters && (
          <Link href="/finance/receipts">
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

      {filtered.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<FileText className="h-10 w-10" />}
          title={hasFilters ? "No documents match" : "No receipts yet"}
          description={
            hasFilters
              ? "Try clearing filters or widening your search."
              : "Upload a bill when creating a payment request, or attach proof when marking one paid — they'll show up here."
          }
        />
      ) : (
        <div className="divide-y divide-border rounded-2xl border border-border bg-card card-elevated">
          {filtered.map((r) => (
            <div
              key={r.url}
              className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    r.kind === "receipt"
                      ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                      : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  }`}
                >
                  {r.kind === "receipt" ? (
                    <Receipt className="h-4 w-4" />
                  ) : (
                    <BadgeCheck className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {r.filename}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {r.description} · {r.payeeName}
                    {r.siteName ? ` · ${r.siteName}` : ""}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Badge variant="outline" className="text-[10px]">
                  {r.kind === "receipt" ? "Bill" : "Proof"}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {expenseCategoryLabel(r.category)}
                </Badge>
                <span className="hidden tabular-nums text-xs text-muted-foreground sm:inline">
                  {inr(r.amountPaise)}
                </span>
                <span className="hidden text-[11px] text-muted-foreground sm:inline">
                  {fmt(r.paidAt ?? r.createdAt)}
                </span>
                <Link
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button size="sm" variant="outline" className="gap-1.5">
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  badge,
  icon,
}: {
  label: string;
  value: string;
  badge: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card card-elevated p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <span className="rounded-md bg-muted p-1.5 text-muted-foreground">
          {icon}
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">{badge}</p>
    </div>
  );
}
