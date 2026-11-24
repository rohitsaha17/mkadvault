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
  // Live status gets a quiet pill with a lit amber dot — the one spot
  // of accent on this card.
  const PIPELINE_COLORS: Record<PipelineStatus, string> = {
    live: "text-foreground bg-muted/60",
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium tracking-tight">
            {tDash("outstanding_ar")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {/* Aging uses stepped neutrals, with the one accent reserved
              for the 90+ bucket so the eye lands on what actually
              needs chasing. */}
          <AgingRow label="0–30 days" amount={agingCurrent} color="text-foreground" />
          <AgingRow label="31–60 days" amount={aging31_60} color="text-muted-foreground" />
          <AgingRow label="61–90 days" amount={aging61_90} color="text-muted-foreground" />
          <AgingRow label="90+ days" amount={aging90plus} color="text-destructive" />
          <div className="border-t border-border pt-2 mt-1">
            <AgingRow label="Total" amount={agingTotal} color="font-medium text-foreground" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium tracking-tight">
            {tDash("outstanding_payables")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-xl bg-muted/40 p-4">
            <p className="text-xs text-muted-foreground">Due in next 30 days</p>
            <p className="mt-1 text-lg font-medium tabular-nums text-foreground">
              {inr(payablesDueSoonTotal)}
            </p>
          </div>
          <div
            className={`rounded-xl p-4 ${
              payablesOverdueTotal > 0
                ? "bg-destructive/10 ring-1 ring-inset ring-destructive/20"
                : "bg-muted/40"
            }`}
          >
            <p className="text-xs text-muted-foreground">Overdue</p>
            <p
              className={`mt-1 text-lg font-medium tabular-nums ${
                payablesOverdueTotal > 0 ? "text-destructive" : "text-foreground"
              }`}
            >
              {inr(payablesOverdueTotal)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium tracking-tight">
            {tDash("campaign_pipeline")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(["live"] as PipelineStatus[]).map((s) => (
            <div key={s} className="flex items-center justify-between gap-2">
              <span
                className={`text-xs px-2 py-0.5 rounded-md inline-flex items-center gap-1.5 ${PIPELINE_COLORS[s]}`}
              >
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full bg-primary"
                />
                {PIPELINE_LABELS[s]}
              </span>
              <span className="text-sm text-foreground tabular-nums">
                {pipeline[s].count}
                <span className="mx-1.5 text-muted-foreground/50">·</span>
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
