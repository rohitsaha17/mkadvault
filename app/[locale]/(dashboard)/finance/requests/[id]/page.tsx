// Full-page payment request detail view. Shows every field on the
// site_expenses row plus linked site / campaign / job, attached
// documents, and a "Download PDF" button that renders the request on
// the organization's letterhead (same signed-logo pattern used for
// invoices).
//
// Intentionally a Server Component — we do the heavy join here and
// pass the shaped object down. Only small interactive bits (PDF
// button, settle actions) are client components.

import { setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import {
  ChevronLeft,
  Paperclip,
  MapPin,
  User,
  CalendarClock,
  FileText,
  IndianRupee,
  Briefcase,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";
import { getSignedUrls } from "@/lib/supabase/signed-urls";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { inr, fmt } from "@/lib/utils";
import {
  expenseCategoryLabel,
  paymentModeLabel,
} from "@/lib/constants/expenses";
import { PaymentRequestPDFButton } from "@/components/expenses/PaymentRequestPDFButton";
import type {
  SiteExpense,
  Organization,
  Site,
  Campaign,
  CampaignJob,
} from "@/lib/types/database";

export const metadata = { title: "Payment request" };

// Shape returned from the joined select below. Pulled out so both the
// page and the PDF button share a single source of truth for what's
// on the row.
type ExpenseWithRelations = SiteExpense & {
  site: Pick<Site, "id" | "name" | "site_code" | "city" | "state"> | null;
  campaign: Pick<Campaign, "id" | "campaign_name" | "campaign_code"> | null;
};

export default async function PaymentRequestDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();
  const session = await getSession();
  if (!session) redirect("/login");
  const { profile } = session;
  if (!profile?.org_id) redirect("/login");

  // Pull everything in parallel. The creator/payer profile names come
  // from a second query because `profiles` isn't joinable directly
  // over Supabase's typed select syntax without a FK hint.
  const [
    { data: expenseData },
    { data: orgData },
  ] = await Promise.all([
    supabase
      .from("site_expenses")
      .select(
        `*,
         site:sites(id, name, site_code, city, state),
         campaign:campaigns(id, campaign_name, campaign_code)`,
      )
      .eq("id", id)
      .is("deleted_at", null)
      .single(),
    supabase
      .from("organizations")
      .select(
        "name, address, city, state, pin_code, gstin, pan, phone, email, logo_url",
      )
      .eq("id", profile.org_id)
      .single(),
  ]);

  if (!expenseData) notFound();

  const expense = expenseData as unknown as ExpenseWithRelations;
  const org = orgData as
    | (Pick<
        Organization,
        | "name"
        | "address"
        | "city"
        | "state"
        | "pin_code"
        | "gstin"
        | "pan"
        | "phone"
        | "email"
      > & { logo_url?: string | null })
    | null;

  // Linked campaign job, if one spawned this expense. Useful context
  // on the detail view — the job carries the "why" (print this
  // creative for that campaign).
  type LinkedJob = Pick<
    CampaignJob,
    "id" | "job_type" | "description" | "status" | "campaign_id"
  >;
  let linkedJob: LinkedJob | null = null;
  {
    const { data } = await supabase
      .from("campaign_jobs")
      .select("id, job_type, description, status, campaign_id")
      .eq("expense_id", id)
      .maybeSingle();
    if (data) linkedJob = data as unknown as LinkedJob;
  }

  // Resolve creator + payer names for the audit trail block.
  const profileIds = [expense.created_by, expense.paid_by].filter(
    (v): v is string => !!v,
  );
  let profileMap: Record<string, string> = {};
  if (profileIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", profileIds);
    profileMap = (data ?? []).reduce<Record<string, string>>((acc, p) => {
      acc[p.id] = p.full_name ?? "—";
      return acc;
    }, {});
  }

  // Sign the org logo so @react-pdf/renderer can embed it into the
  // generated PDF. Same 1-hour TTL used on invoices/proposals.
  let orgLogoUrl: string | null = null;
  if (org?.logo_url) {
    const { data: signed } = await supabase.storage
      .from("org-logos")
      .createSignedUrl(org.logo_url, 60 * 60);
    orgLogoUrl = signed?.signedUrl ?? null;
  }

  // Org-wide payment-voucher T&C (migration 040). Fetched on its own
  // so a missing column doesn't null out the core org row above. When
  // the column / value is missing the PDF skips the T&C block.
  const paymentVoucherTerms: string | null = await (async () => {
    const { data, error } = await supabase
      .from("organizations")
      .select("payment_voucher_terms_template")
      .eq("id", profile.org_id)
      .maybeSingle();
    if (error || !data) return null;
    return (data as { payment_voucher_terms_template?: string | null })
      .payment_voucher_terms_template ?? null;
  })();

  // Sign private document URLs (receipts + payment proofs) so they're
  // clickable from the page. `expense-docs` bucket is private.
  const docPaths = [
    ...(expense.receipt_doc_urls ?? []),
    ...(expense.payment_proof_urls ?? []),
  ].filter((u): u is string => !!u && !/^https?:\/\//i.test(u));
  const signedDocs = await getSignedUrls("expense-docs", docPaths);
  function resolveDoc(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    return signedDocs[path] ?? "#";
  }

  // Short 8-char ID used as a human-friendly tag alongside the full
  // UUID. Matches the pattern we introduced on campaigns and jobs.
  const shortId = expense.id.slice(0, 8);

  // Computed net payable after TDS (if landowner rent with TDS
  // withheld). `amount_paise` is the gross; `tds_paise` is the
  // withholding that goes to the tax department separately.
  const netPayablePaise =
    expense.amount_paise - (expense.tds_paise ?? 0);

  return (
    <div className="max-w-5xl">
      {/* ── Breadcrumb + actions ─────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/finance/requests"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Payment requests
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {expense.description}
            </h1>
            <StatusBadge status={expense.status} />
            <code
              className="rounded bg-muted px-2 py-0.5 text-[11px] font-mono text-muted-foreground"
              title={`ID: ${expense.id}`}
            >
              {shortId}
            </code>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {expenseCategoryLabel(expense.category)} · Created{" "}
            {format(new Date(expense.created_at), "dd MMM yyyy")}
            {profileMap[expense.created_by ?? ""] &&
              ` by ${profileMap[expense.created_by!]}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {org && (
            <PaymentRequestPDFButton
              expense={expense}
              org={org}
              orgLogoUrl={orgLogoUrl}
              site={expense.site}
              campaign={expense.campaign}
              createdByName={profileMap[expense.created_by ?? ""] ?? null}
              paidByName={profileMap[expense.paid_by ?? ""] ?? null}
              termsText={paymentVoucherTerms}
              filename={`PaymentRequest-${shortId}.pdf`}
            />
          )}
        </div>
      </div>

      {/* ── Summary tiles ────────────────────────────────────────────── */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <SummaryTile
          icon={<IndianRupee className="h-4 w-4" />}
          label="Amount"
          value={inr(expense.amount_paise)}
        />
        {expense.tds_paise ? (
          <>
            <SummaryTile
              icon={<IndianRupee className="h-4 w-4" />}
              label="TDS withheld"
              value={inr(expense.tds_paise)}
              tone="warning"
            />
            <SummaryTile
              icon={<IndianRupee className="h-4 w-4" />}
              label="Net payable"
              value={inr(netPayablePaise)}
              tone="success"
            />
          </>
        ) : (
          <SummaryTile
            icon={<CalendarClock className="h-4 w-4" />}
            label="Needed by"
            value={expense.needed_by ? fmt(expense.needed_by) : "—"}
          />
        )}
        <SummaryTile
          icon={<User className="h-4 w-4" />}
          label="Payee"
          value={expense.payee_name}
          sub={expense.payee_type}
        />
      </div>

      {/* ── Details card ─────────────────────────────────────────────── */}
      <section className="mb-6 rounded-2xl border border-border bg-card card-elevated p-5 sm:p-6">
        <SectionHeading icon={<FileText className="h-4 w-4" />}>
          Request details
        </SectionHeading>
        <div className="grid grid-cols-1 gap-x-10 gap-y-4 md:grid-cols-2">
          <Field label="Category" value={expenseCategoryLabel(expense.category)} />
          <Field
            label="Status"
            value={<StatusBadge status={expense.status} />}
          />
          <Field
            label="Needed by"
            value={expense.needed_by ? fmt(expense.needed_by) : "—"}
          />
          <Field
            label="Amount"
            value={<span className="tabular-nums font-medium">{inr(expense.amount_paise)}</span>}
          />
          {expense.tds_paise != null && expense.tds_paise > 0 && (
            <>
              <Field
                label="TDS withheld"
                value={
                  <span className="tabular-nums">{inr(expense.tds_paise)}</span>
                }
              />
              <Field
                label="Net payable"
                value={
                  <span className="tabular-nums font-medium">
                    {inr(netPayablePaise)}
                  </span>
                }
              />
            </>
          )}
          <Field
            label="Description"
            value={expense.description}
            fullWidth
          />
          {expense.notes && (
            <Field label="Internal notes" value={expense.notes} fullWidth />
          )}
        </div>
      </section>

      {/* ── Payee details card ──────────────────────────────────────── */}
      <section className="mb-6 rounded-2xl border border-border bg-card card-elevated p-5 sm:p-6">
        <SectionHeading icon={<User className="h-4 w-4" />}>
          Payee
        </SectionHeading>
        <div className="grid grid-cols-1 gap-x-10 gap-y-4 md:grid-cols-2">
          <Field label="Name" value={expense.payee_name} />
          <Field
            label="Type"
            value={
              <span className="capitalize">{expense.payee_type}</span>
            }
          />
          {expense.payee_contact && (
            <Field label="Contact" value={expense.payee_contact} />
          )}
          {expense.payee_bank_details &&
            Object.keys(expense.payee_bank_details).length > 0 && (
              <div className="md:col-span-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Bank details
                </p>
                <pre className="mt-1 whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-xs text-foreground font-mono">
                  {Object.entries(expense.payee_bank_details)
                    .map(([k, v]) => `${k}: ${String(v)}`)
                    .join("\n")}
                </pre>
              </div>
            )}
        </div>
      </section>

      {/* ── Linked records card ─────────────────────────────────────── */}
      {(expense.site || expense.campaign || linkedJob) && (
        <section className="mb-6 rounded-2xl border border-border bg-card card-elevated p-5 sm:p-6">
          <SectionHeading icon={<MapPin className="h-4 w-4" />}>
            Linked records
          </SectionHeading>
          <div className="grid grid-cols-1 gap-x-10 gap-y-4 md:grid-cols-2">
            {expense.site ? (
              <Field
                label="Site"
                value={
                  <Link
                    href={`/sites/${expense.site.id}`}
                    className="text-primary hover:underline"
                  >
                    {expense.site.name}
                    {expense.site.site_code && (
                      <span className="ml-1 text-xs font-mono text-muted-foreground">
                        {expense.site.site_code}
                      </span>
                    )}
                  </Link>
                }
                sub={
                  expense.site.city
                    ? `${expense.site.city}, ${expense.site.state}`
                    : undefined
                }
              />
            ) : (
              <Field
                label="Site"
                value={<span className="text-muted-foreground">Overhead (not tied to a site)</span>}
              />
            )}
            {expense.campaign && (
              <Field
                label="Campaign"
                value={
                  <Link
                    href={`/campaigns/${expense.campaign.id}`}
                    className="text-primary hover:underline"
                  >
                    {expense.campaign.campaign_name}
                    {expense.campaign.campaign_code && (
                      <span className="ml-1 text-xs font-mono text-muted-foreground">
                        {expense.campaign.campaign_code}
                      </span>
                    )}
                  </Link>
                }
              />
            )}
            {linkedJob && (
              <Field
                label="Campaign job"
                value={
                  <Link
                    href={`/campaigns/${linkedJob.campaign_id}`}
                    className="inline-flex items-center gap-1.5 text-primary hover:underline"
                  >
                    <Briefcase className="h-3.5 w-3.5" />
                    <span className="capitalize">
                      {linkedJob.job_type.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground">
                      {linkedJob.id.slice(0, 8)}
                    </span>
                  </Link>
                }
                sub={linkedJob.description}
              />
            )}
          </div>
        </section>
      )}

      {/* ── Settlement card ─────────────────────────────────────────── */}
      {expense.status === "paid" && (
        <section className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50/40 dark:border-emerald-500/30 dark:bg-emerald-500/10 p-5 sm:p-6">
          <SectionHeading icon={<IndianRupee className="h-4 w-4" />}>
            Settlement
          </SectionHeading>
          <div className="grid grid-cols-1 gap-x-10 gap-y-4 md:grid-cols-2">
            <Field
              label="Paid on"
              value={expense.paid_at ? fmt(expense.paid_at) : "—"}
            />
            <Field
              label="Payment mode"
              value={paymentModeLabel(expense.payment_mode)}
            />
            {expense.payment_reference && (
              <Field
                label="Reference"
                value={
                  <code className="rounded bg-background px-1.5 py-0.5 text-xs font-mono">
                    {expense.payment_reference}
                  </code>
                }
              />
            )}
            {expense.paid_by && profileMap[expense.paid_by] && (
              <Field
                label="Paid by"
                value={profileMap[expense.paid_by]}
              />
            )}
          </div>
        </section>
      )}

      {/* ── Attachments card ────────────────────────────────────────── */}
      {((expense.receipt_doc_urls?.length ?? 0) > 0 ||
        (expense.payment_proof_urls?.length ?? 0) > 0) && (
        <section className="mb-6 rounded-2xl border border-border bg-card card-elevated p-5 sm:p-6">
          <SectionHeading icon={<Paperclip className="h-4 w-4" />}>
            Attachments
          </SectionHeading>
          {(expense.receipt_doc_urls?.length ?? 0) > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Receipts / supporting docs
              </p>
              <ul className="space-y-1">
                {expense.receipt_doc_urls!.map((path) => (
                  <li key={path}>
                    <a
                      href={resolveDoc(path)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                      {path.split("/").pop()}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(expense.payment_proof_urls?.length ?? 0) > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Payment proofs
              </p>
              <ul className="space-y-1">
                {expense.payment_proof_urls!.map((path) => (
                  <li key={path}>
                    <a
                      href={resolveDoc(path)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                      {path.split("/").pop()}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* ── Audit trail ────────────────────────────────────────────── */}
      <section className="mb-6 rounded-2xl border border-border bg-card card-elevated p-5 sm:p-6">
        <SectionHeading icon={<CalendarClock className="h-4 w-4" />}>
          Audit trail
        </SectionHeading>
        <div className="grid grid-cols-1 gap-x-10 gap-y-4 md:grid-cols-2">
          <Field
            label="Created"
            value={format(new Date(expense.created_at), "dd MMM yyyy, HH:mm")}
            sub={
              profileMap[expense.created_by ?? ""]
                ? `by ${profileMap[expense.created_by!]}`
                : undefined
            }
          />
          <Field
            label="Last updated"
            value={format(new Date(expense.updated_at), "dd MMM yyyy, HH:mm")}
          />
          <Field
            label="Record ID"
            value={
              <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono">
                {expense.id}
              </code>
            }
            fullWidth
          />
        </div>
      </section>

      <div className="flex justify-between">
        <Link href="/finance/requests">
          <Button variant="outline" size="sm">
            ← Back to list
          </Button>
        </Link>
      </div>
    </div>
  );
}

// ─── Small local components ────────────────────────────────────────────────

function SummaryTile({
  icon,
  label,
  value,
  sub,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: "neutral" | "success" | "warning";
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
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <Badge variant="outline" className="gap-1 text-[10px]">
          {icon}
        </Badge>
      </div>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${toneClass}`}>
        {value}
      </p>
      {sub && (
        <p className="text-xs capitalize text-muted-foreground">{sub}</p>
      )}
    </div>
  );
}

function SectionHeading({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
      <span className="text-muted-foreground">{icon}</span>
      <h2 className="text-sm font-semibold text-foreground">{children}</h2>
    </div>
  );
}

function Field({
  label,
  value,
  sub,
  fullWidth = false,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? "md:col-span-2" : undefined}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 text-sm text-foreground">{value}</div>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
