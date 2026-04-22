import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { differenceInDays } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { inr, fmt } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft, AlertTriangle, FileText, Building2, Pencil, Calendar, CreditCard, Receipt, ScrollText,
} from "lucide-react";
import { PaymentScheduleTable } from "@/components/contracts/PaymentScheduleTable";
import { ContractDocumentsCard } from "@/components/contracts/ContractDocumentsCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { Contract, Landowner, PartnerAgency, Site, ContractPayment } from "@/lib/types/database";

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();

  const { data: cData } = await supabase
    .from("contracts").select("*").eq("id", id).is("deleted_at", null).single();

  if (!cData) notFound();
  const contract = cData as unknown as Contract;

  // Fetch party and site in parallel
  const [partyResult, siteResult, paymentsResult] = await Promise.all([
    contract.contract_type === "landowner" && contract.landowner_id
      ? supabase.from("landowners").select("id, full_name, phone, email, city").eq("id", contract.landowner_id).single()
      : contract.agency_id
        ? supabase.from("partner_agencies").select("id, agency_name, contact_person, phone, email, city").eq("id", contract.agency_id).single()
        : Promise.resolve({ data: null }),
    supabase.from("sites").select("id, name, site_code, city, state, address").eq("id", contract.site_id).single(),
    supabase.from("contract_payments")
      .select("*")
      .eq("contract_id", id)
      .order("due_date")
      .limit(100),
  ]);

  const party = partyResult.data;
  const site = siteResult.data as unknown as Pick<Site, "id" | "name" | "site_code" | "city" | "state" | "address"> | null;
  const payments = (paymentsResult.data ?? []) as unknown as ContractPayment[];

  const daysToExpiry = contract.end_date
    ? differenceInDays(new Date(contract.end_date), new Date())
    : null;
  const isExpiringSoon = daysToExpiry !== null && daysToExpiry <= 90 && daysToExpiry >= 0;

  const partyName = contract.contract_type === "landowner"
    ? (party as Pick<Landowner, "id" | "full_name"> | null)?.full_name
    : (party as Pick<PartnerAgency, "id" | "agency_name"> | null)?.agency_name;

  const partyHref = contract.contract_type === "landowner"
    ? `/landowners/${contract.landowner_id}`
    : `/agencies/${contract.agency_id}`;

  // Payment summary stats
  const paidCount = payments.filter((p) => p.status === "paid").length;
  const overdueCount = payments.filter((p) => p.status === "overdue").length;
  const dueCount = payments.filter((p) => p.status === "due").length;
  const totalPaid = payments
    .filter((p) => p.amount_paid_paise)
    .reduce((sum, p) => sum + (p.amount_paid_paise ?? 0), 0);
  const totalDue = payments.reduce((sum, p) => sum + p.amount_due_paise, 0);

  return (
    <div className="max-w-5xl">
      {/* Breadcrumb + actions */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/contracts"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to Contracts
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {partyName ?? "Contract"}
            </h1>
            <StatusBadge status={contract.status} />
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="capitalize">{contract.contract_type} contract</span>
            <span>·</span>
            <span className="tabular-nums">
              {fmt(contract.start_date)} → {contract.end_date ? fmt(contract.end_date) : "Open-ended"}
            </span>
          </div>
        </div>
        <Link href={`/contracts/${id}/edit`}>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
        </Link>
      </div>

      {isExpiringSoon && (
        <div className="mb-6 flex items-center gap-2 rounded-2xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0 text-muted-foreground" />
          This contract expires in <strong>{daysToExpiry} day{daysToExpiry !== 1 ? "s" : ""}</strong>.
          Consider renewing soon.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: Details */}
        <div className="space-y-6 lg:col-span-2">

          {/* Payment terms */}
          <Section title="Payment Terms" icon={<CreditCard className="h-4 w-4" />}>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Payment Model</p>
                <p className="mt-0.5 font-medium capitalize text-foreground">
                  {contract.payment_model.replace(/_/g, " ")}
                </p>
              </div>
              {contract.rent_amount_paise && (
                <div>
                  <p className="text-xs text-muted-foreground">
                    {contract.payment_model === "yearly_lumpsum" ? "Annual Amount" : "Monthly Rent"}
                  </p>
                  <p className="mt-0.5 font-medium tabular-nums text-foreground">{inr(contract.rent_amount_paise)}</p>
                </div>
              )}
              {contract.payment_model === "revenue_share" && (
                <>
                  <div>
                    <p className="text-xs text-muted-foreground">Revenue Share</p>
                    <p className="mt-0.5 font-medium tabular-nums text-foreground">{contract.revenue_share_percentage ?? "—"}%</p>
                  </div>
                  {contract.minimum_guarantee_paise && (
                    <div>
                      <p className="text-xs text-muted-foreground">Minimum Guarantee / mo</p>
                      <p className="mt-0.5 font-medium tabular-nums text-foreground">{inr(contract.minimum_guarantee_paise)}</p>
                    </div>
                  )}
                </>
              )}
              {contract.payment_day_of_month && (
                <div>
                  <p className="text-xs text-muted-foreground">Payment Day</p>
                  <p className="mt-0.5 font-medium text-foreground">{contract.payment_day_of_month}th of month</p>
                </div>
              )}
              {contract.escalation_percentage && (
                <div>
                  <p className="text-xs text-muted-foreground">Escalation</p>
                  <p className="mt-0.5 font-medium text-foreground">
                    {contract.escalation_percentage}% every {contract.escalation_frequency_months ?? 12} months
                  </p>
                </div>
              )}
            </div>
          </Section>

          {/* Term details */}
          <Section title="Contract Term" icon={<Calendar className="h-4 w-4" />}>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Start Date</p>
                <p className="mt-0.5 font-medium tabular-nums text-foreground">{fmt(contract.start_date)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">End Date</p>
                <p className="mt-0.5 font-medium tabular-nums text-foreground">{contract.end_date ? fmt(contract.end_date) : "Open-ended"}</p>
              </div>
              {contract.renewal_date && (
                <div>
                  <p className="text-xs text-muted-foreground">Renewal Date</p>
                  <p className="mt-0.5 font-medium tabular-nums text-foreground">{fmt(contract.renewal_date)}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground">Notice Period</p>
                <p className="mt-0.5 font-medium text-foreground">{contract.notice_period_days} days</p>
              </div>
              {contract.lock_period_months && (
                <div>
                  <p className="text-xs text-muted-foreground">Lock-in Period</p>
                  <p className="mt-0.5 font-medium text-foreground">{contract.lock_period_months} months</p>
                </div>
              )}
            </div>
            {contract.early_termination_clause && (
              <div className="mt-4">
                <p className="mb-1 text-xs text-muted-foreground">Early Termination Clause</p>
                <p className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm text-foreground">
                  {contract.early_termination_clause}
                </p>
              </div>
            )}
          </Section>

          {/* T&C clauses */}
          {contract.terms_clauses && contract.terms_clauses.length > 0 && (
            <Section title="Terms & Conditions" icon={<ScrollText className="h-4 w-4" />}>
              <ol className="space-y-4">
                {contract.terms_clauses.map((clause, i) => (
                  <li key={i} className="border-l-2 border-border pl-3">
                    <p className="text-sm font-semibold text-foreground">
                      {i + 1}. {clause.title}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                      {clause.content}
                    </p>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {/* Documents — draft + signed copy upload */}
          <ContractDocumentsCard
            contractId={id}
            draftPath={contract.contract_document_url}
            signedPath={contract.signed_document_url}
          />

          {/* Notes */}
          {contract.notes && (
            <Section title="Notes" icon={<FileText className="h-4 w-4" />}>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{contract.notes}</p>
            </Section>
          )}

          {/* Payment schedule */}
          <section className="overflow-hidden rounded-2xl border border-border bg-card card-elevated">
            <div className="flex items-center justify-between border-b border-border bg-muted px-5 py-4">
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-muted-foreground" />
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Payment Schedule</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {paidCount} paid · {dueCount} due · {overdueCount} overdue
                  </p>
                </div>
              </div>
              <div className="text-right text-sm">
                <p className="text-xs text-muted-foreground">Total paid</p>
                <p className="font-semibold tabular-nums text-foreground">{inr(totalPaid)}</p>
              </div>
            </div>
            <PaymentScheduleTable payments={payments} contractId={id} />
          </section>
        </div>

        {/* Right: sidebar */}
        <div className="space-y-4">
          {/* Party card */}
          {party && (
            <SidebarCard title={contract.contract_type === "landowner" ? "Landowner" : "Agency"}>
              <Link href={partyHref} className="block font-semibold text-foreground hover:text-primary hover:underline">
                {partyName}
              </Link>
              {"phone" in party && (party as { phone?: string }).phone && (
                <p className="text-xs text-muted-foreground">{(party as { phone: string }).phone}</p>
              )}
              {"email" in party && (party as { email?: string }).email && (
                <p className="text-xs text-muted-foreground">{(party as { email: string }).email}</p>
              )}
              {"city" in party && (party as { city?: string }).city && (
                <p className="text-xs text-muted-foreground">{(party as { city: string }).city}</p>
              )}
            </SidebarCard>
          )}

          {/* Site card */}
          {site && (
            <SidebarCard title="Site">
              <Link href={`/sites/${contract.site_id}`} className="flex items-center gap-1.5 font-semibold text-foreground hover:text-primary hover:underline">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                {site.name}
              </Link>
              {site.site_code && <p className="font-mono text-xs text-muted-foreground">{site.site_code}</p>}
              {(site.city || site.state) && (
                <p className="text-xs text-muted-foreground">{[site.city, site.state].filter(Boolean).join(", ")}</p>
              )}
            </SidebarCard>
          )}

          {/* Payment summary */}
          <SidebarCard title="Payment Summary">
            <SidebarRow label="Total scheduled">
              <span className="font-medium tabular-nums text-foreground">{inr(totalDue)}</span>
            </SidebarRow>
            <SidebarRow label="Total paid">
              <span className="font-medium tabular-nums text-foreground">{inr(totalPaid)}</span>
            </SidebarRow>
            <div className="flex items-center justify-between gap-3 border-t border-border pt-2.5">
              <dt className="text-muted-foreground">Outstanding</dt>
              <dd className="font-semibold tabular-nums text-foreground">{inr(totalDue - totalPaid)}</dd>
            </div>
          </SidebarCard>
        </div>
      </div>
    </div>
  );
}

// ─── Helper components ────────────────────────────────────────────────────────

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card card-elevated p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
        <span className="text-muted-foreground">{icon}</span>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function SidebarCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card card-elevated p-5">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      <dl className="space-y-2.5 text-sm">{children}</dl>
    </div>
  );
}

function SidebarRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
