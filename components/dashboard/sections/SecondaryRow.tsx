// Row 3: three compact cards — Receivables aging, Payables status,
// Campaign pipeline. Own Suspense boundary; renders independently
// of the KPI/chart rows above.
import { parseISO, addDays } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { inr } from "@/lib/utils";
import { getTranslations } from "next-intl/server";
import type { CampaignStatus } from "@/lib/types/database";

// After migration 035 the pipeline is just one bucket: live. Keep the
// type alias for readability even with a single value — makes it
// obvious where to extend if the team re-introduces sub-statuses.
type PipelineStatus = "live";

export async function SecondaryRow({ orgId }: { orgId: string }) {
  const supabase = await createClient();
  const tDash = await getTranslations("dashboard");

  const now = new Date();
  const thirtyDaysFromNow = addDays(now, 30).toISOString();

  const [
    { data: agingInvoices },
    { data: payablesDueSoon },
    { data: payablesOverdue },
    { data: pipelineCampaigns },
  ] = await Promise.all([
    supabase
      .from("invoices")
      .select("due_date, balance_due_paise")
      .eq("organization_id", orgId)
      .in("status", ["sent", "partially_paid", "overdue"])
      .is("deleted_at", null),
    supabase
      .from("contract_payments")
      .select("amount_due_paise")
      .eq("organization_id", orgId)
      .eq("status", "upcoming")
      .lte("due_date", thirtyDaysFromNow),
    supabase
      .from("contract_payments")
      .select("amount_due_paise")
      .eq("organization_id", orgId)
      .eq("status", "overdue"),
    supabase
      .from("campaigns")
      .select("status, total_value_paise")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .eq("status", "live"),
  ]);

  // Aging buckets
  let agingCurrent = 0, aging31_60 = 0, aging61_90 = 0, aging90plus = 0;
  for (const row of (agingInvoices ?? []) as Array<{ due_date: string; balance_due_paise: number }>) {
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

  const payablesDueSoonTotal = (payablesDueSoon ?? []).reduce(
    (s, r) => s + (r.amount_due_paise ?? 0),
    0,
  );
  const payablesOverdueTotal = (payablesOverdue ?? []).reduce(
    (s, r) => s + (r.amount_due_paise ?? 0),
    0,
  );

  const pipeline: Record<PipelineStatus, { count: number; value: number }> = {
    live: { count: 0, value: 0 },
  };
  for (const row of (pipelineCampaigns ?? []) as Array<{ status: CampaignStatus; total_value_paise: number | null }>) {
    if (row.status === "live") {
      pipeline.live.count += 1;
      pipeline.live.value += row.total_value_paise ?? 0;
    }
  }

  const PIPELINE_LABELS: Record<PipelineStatus, string> = {
    live: "Live",
  };
  const PIPELINE_COLORS: Record<PipelineStatus, string> = {
    live: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{tDash("outstanding_payables")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl bg-muted/40 p-4">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
              Due in next 30 days
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
              {inr(payablesDueSoonTotal)}
            </p>
          </div>
          <div className="rounded-xl bg-rose-50/70 dark:bg-rose-500/10 p-4 ring-1 ring-inset ring-rose-200/60 dark:ring-rose-500/20">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-rose-700/80 dark:text-rose-300/80">
              Overdue
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-rose-700 dark:text-rose-300">
              {inr(payablesOverdueTotal)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{tDash("campaign_pipeline")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(["live"] as PipelineStatus[]).map((s) => (
            <div key={s} className="flex items-center justify-between gap-2">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PIPELINE_COLORS[s]}`}>
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
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function AgingRow({ label, amount, color }: { label: string; amount: number; color: string }) {
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
