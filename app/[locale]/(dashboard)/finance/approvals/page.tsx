// Approvals queue — every PENDING payment request that needs review
// from someone with finance authority. Non-finance users land on a
// friendly "not-permitted" notice instead of a crash.
//
// The list itself reuses the shared ExpensesList so the approve/reject/
// mark-paid actions match the rest of the Finance module.
import { setRequestLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  ExpensesList,
  type ExpenseRow,
} from "@/components/expenses/ExpensesList";
import { Badge } from "@/components/ui/badge";
import { inr } from "@/lib/utils";
import { AlertTriangle, CheckCheck } from "lucide-react";
import type { UserRole } from "@/lib/types/database";

export const metadata = { title: "Approvals" };

const FINANCE_ROLES: UserRole[] = [
  "super_admin",
  "admin",
  "manager",
  "accounts",
];

export default async function FinanceApprovalsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

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

  if (!canSettle) {
    return (
      <div>
        <PageHeader
          eyebrow="Finance"
          title="Approvals"
          description="Review payment requests and approve them for settlement."
        />
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            Only admins and accountants can approve payment requests.
          </div>
          <p>
            If you need approval authority, ask your organisation admin to add
            you to the <span className="font-medium">admin</span> or{" "}
            <span className="font-medium">accounts</span> role from Settings →
            Team members.
          </p>
        </div>
      </div>
    );
  }

  // Pending requests, oldest first so the most overdue stuff floats up.
  const { data, error } = await supabase
    .from("site_expenses")
    .select(
      `id, category, description, amount_paise, status, payee_name, payee_type,
       needed_by, paid_at, payment_mode, receipt_doc_urls, payment_proof_urls,
       created_at, site_id,
       site:sites(id, name, site_code)`,
    )
    .is("deleted_at", null)
    .eq("status", "pending")
    .order("needed_by", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    // 100 most urgent pending approvals — anything past that is the
    // approver's own backlog problem; surface a "you have a backlog"
    // hint elsewhere rather than dragging the page weight up.
    .limit(100);

  const expenses: ExpenseRow[] = ((data ?? []) as unknown as Array<
    Omit<ExpenseRow, "site"> & {
      site: ExpenseRow["site"] | ExpenseRow["site"][] | null;
    }
  >).map((r) => ({
    ...r,
    site: Array.isArray(r.site) ? r.site[0] ?? null : r.site ?? null,
  }));

  const totalPending = expenses.reduce((a, e) => a + e.amount_paise, 0);
  const today = new Date().toISOString().slice(0, 10);
  const overdueCount = expenses.filter(
    (e) => e.needed_by && e.needed_by < today,
  ).length;

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title="Approvals"
        description="Payment requests awaiting your review. Approve or reject to move them out of the queue."
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Pending review"
          value={String(expenses.length)}
          badge={expenses.length > 0 ? "action needed" : "all clear"}
          tone={expenses.length > 0 ? "warning" : "success"}
        />
        <StatCard
          label="Total value"
          value={inr(totalPending)}
          badge="across pending"
          tone="neutral"
        />
        <StatCard
          label="Past needed-by"
          value={String(overdueCount)}
          badge={overdueCount > 0 ? "overdue" : "on track"}
          tone={overdueCount > 0 ? "warning" : "success"}
        />
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          Failed to load: {error.message}
        </div>
      )}

      {!error && expenses.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<CheckCheck className="h-10 w-10" />}
          title="Inbox zero"
          description="No payment requests are waiting for your approval. Nicely done."
        />
      ) : (
        !error && (
          <ExpensesList
            expenses={expenses}
            canSettle={canSettle}
            emptyMessage="No requests pending approval."
          />
        )
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
