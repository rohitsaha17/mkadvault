import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, FileText, Receipt, Building2, History } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";
import { inr, fmt } from "@/lib/utils";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { BillingNav } from "@/components/billing/BillingNav";
import { InvoiceDetailActions } from "@/components/billing/InvoiceDetailActions";
import type { Invoice, InvoiceLineItem, Client, Organization, OrganizationBankAccount, PaymentReceived } from "@/lib/types/database";

export const metadata = { title: "Invoice" };

const SERVICE_LABELS: Record<string, string> = {
  display_rental: "Display Rental",
  flex_printing: "Flex Printing",
  mounting: "Mounting",
  design: "Design",
  transport: "Transport",
  other: "Other",
};

const PM_LABELS: Record<string, string> = {
  cash: "Cash", cheque: "Cheque", bank_transfer: "Bank Transfer",
  upi: "UPI", online: "Online",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface InvoiceWithClient extends Invoice {
  client?: Pick<Client, "id" | "company_name" | "brand_name" | "billing_address" | "billing_city" | "billing_state" | "billing_pin_code" | "gstin" | "pan"> | null;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();

  const [
    { data: invData },
    { data: lineItemsData },
    { data: paymentsData },
    session,
  ] = await Promise.all([
    supabase
      .from("invoices")
      .select("*, client:clients(id, company_name, brand_name, billing_address, billing_city, billing_state, billing_pin_code, gstin, pan)")
      .eq("id", id)
      .is("deleted_at", null)
      .single(),
    supabase
      .from("invoice_line_items")
      .select("*")
      .eq("invoice_id", id)
      .order("created_at"),
    supabase
      .from("payments_received")
      .select("*")
      .eq("invoice_id", id)
      .order("payment_date"),
    getSession(),
  ]);

  const profileOrgId: string | null = session?.profile?.org_id ?? null;

  if (!invData) notFound();

  const invoice = invData as unknown as InvoiceWithClient;
  const lineItems = (lineItemsData ?? []) as unknown as InvoiceLineItem[];
  const payments = (paymentsData ?? []) as unknown as PaymentReceived[];

  // Fetch org data + optional bank account + signed logo URL in parallel
  type OrgData = Pick<Organization, "name" | "address" | "city" | "state" | "pin_code" | "gstin" | "pan" | "phone" | "email" | "logo_url">;
  let org: OrgData | null = null;
  let bankAccount: Pick<
    OrganizationBankAccount,
    | "label"
    | "bank_name"
    | "account_holder_name"
    | "account_number"
    | "ifsc_code"
    | "branch_name"
    | "account_type"
    | "upi_id"
    | "swift_code"
  > | null = null;
  let orgLogoUrl: string | null = null;

  if (profileOrgId) {
    const [{ data: orgData }, { data: bankData }] = await Promise.all([
      supabase
        .from("organizations")
        .select("name, address, city, state, pin_code, gstin, pan, phone, email, logo_url")
        .eq("id", profileOrgId)
        .single(),
      invoice.bank_account_id
        ? supabase
            .from("organization_bank_accounts")
            .select("label, bank_name, account_holder_name, account_number, ifsc_code, branch_name, account_type, upi_id, swift_code")
            .eq("id", invoice.bank_account_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    if (orgData) org = orgData as unknown as OrgData;
    if (bankData) bankAccount = bankData as unknown as typeof bankAccount;
    // Sign the private-bucket logo so the PDF's <Image> can fetch it.
    if (org?.logo_url) {
      const { data: signed } = await supabase.storage
        .from("org-logos")
        .createSignedUrl(org.logo_url, 60 * 60);
      orgLogoUrl = signed?.signedUrl ?? null;
    }
  }

  const client = invoice.client;

  // Build PDF props (only when we have org data)
  const pdfReady = org !== null && client !== null;

  return (
    <div className="max-w-5xl">
      {/* Breadcrumb + actions */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/billing/invoices"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Invoices
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold tracking-tight text-foreground">
              {invoice.invoice_number}
            </h1>
            <StatusBadge status={invoice.status} />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {client ? (
              <Link href={`/clients/${client.id}`} className="hover:text-foreground transition-colors">
                {client.company_name}
              </Link>
            ) : "Unknown client"}{" "}
            · Dated {fmt(invoice.invoice_date)}
            {invoice.campaign_id && (
              <> · <Link href={`/campaigns/${invoice.campaign_id}`} className="hover:text-foreground transition-colors">View Campaign</Link></>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <InvoiceDetailActions
            invoiceId={invoice.id}
            invoiceNumber={invoice.invoice_number}
            currentStatus={invoice.status}
            balanceDuePaise={invoice.balance_due_paise ?? 0}
            pdfProps={pdfReady && org && client ? {
              invoice: invoice as Invoice,
              lineItems,
              client,
              org,
              bankAccount,
              orgLogoUrl,
              filename: `${invoice.invoice_number}.pdf`,
            } : undefined}
          />
        </div>
      </div>

      <div className="mb-6">
        <BillingNav />
      </div>

      {/* Invoice Card */}
      <section className="rounded-2xl border border-border bg-card card-elevated p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
          <span className="text-muted-foreground">
            <Receipt className="h-4 w-4" />
          </span>
          <h2 className="text-sm font-semibold text-foreground">Tax Invoice</h2>
        </div>

        {/* Org / Invoice meta */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-base font-semibold text-foreground">{org?.name ?? "Your Organization"}</p>
            {org?.address && <p className="text-sm text-muted-foreground">{org.address}</p>}
            {(org?.city || org?.state) && (
              <p className="text-sm text-muted-foreground">
                {[org?.city, org?.state, org?.pin_code].filter(Boolean).join(", ")}
              </p>
            )}
            {org?.gstin && (
              <p className="mt-1 text-xs text-muted-foreground">
                GSTIN: <span className="font-mono text-foreground">{org.gstin}</span>
              </p>
            )}
            {org?.phone && <p className="text-xs text-muted-foreground">{org.phone}</p>}
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tax Invoice</p>
            <p className="font-mono text-lg font-semibold text-foreground">{invoice.invoice_number}</p>
            <p className="mt-1 text-sm tabular-nums text-muted-foreground">Date: {fmt(invoice.invoice_date)}</p>
            <p className="text-sm tabular-nums text-muted-foreground">Due: {fmt(invoice.due_date)}</p>
          </div>
        </div>
      </section>

      <div className="mt-6 space-y-6">
        {/* Bill To + GST Info */}
        <section className="rounded-2xl border border-border bg-card card-elevated p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
            <span className="text-muted-foreground">
              <Building2 className="h-4 w-4" />
            </span>
            <h2 className="text-sm font-semibold text-foreground">Bill To &amp; GST</h2>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Bill To</p>
              {client ? (
                <Link href={`/clients/${client.id}`} className="font-semibold text-foreground hover:text-primary hover:underline">
                  {client.company_name}
                </Link>
              ) : (
                <p className="font-semibold text-foreground">—</p>
              )}
              {client?.brand_name && <p className="text-sm text-muted-foreground">{client.brand_name}</p>}
              {client?.billing_address && <p className="text-sm text-muted-foreground">{client.billing_address}</p>}
              {(client?.billing_city || client?.billing_state) && (
                <p className="text-sm text-muted-foreground">
                  {[client?.billing_city, client?.billing_state, client?.billing_pin_code].filter(Boolean).join(", ")}
                </p>
              )}
              {client?.gstin && (
                <p className="mt-1 text-xs text-muted-foreground">
                  GSTIN: <span className="font-mono text-foreground">{client.gstin}</span>
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Place of Supply</p>
                <p className="text-sm text-foreground">{invoice.place_of_supply_state ?? org?.state ?? "—"}</p>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Tax Type</p>
                <p className="text-sm text-foreground">{invoice.is_inter_state ? "IGST (Inter-State)" : "CGST + SGST (Intra-State)"}</p>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">SAC Code</p>
                <p className="font-mono text-sm text-foreground">{invoice.sac_code}</p>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Supplier GSTIN</p>
                <p className="font-mono text-sm text-foreground">{invoice.supplier_gstin ?? "—"}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Line Items */}
        <section className="rounded-2xl border border-border bg-card card-elevated p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
            <span className="text-muted-foreground">
              <FileText className="h-4 w-4" />
            </span>
            <h2 className="text-sm font-semibold text-foreground">Line Items</h2>
          </div>

          <div className="overflow-hidden rounded-xl border border-border">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground">
                  <tr>
                    <th className="w-8 px-4 py-3 text-left">#</th>
                    <th className="px-4 py-3 text-left">Description</th>
                    <th className="px-4 py-3 text-left">HSN/SAC</th>
                    <th className="px-4 py-3 text-left">Period</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3 text-right">Rate</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item, i) => (
                    <tr key={item.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{item.description}</p>
                        <p className="text-xs text-muted-foreground">{SERVICE_LABELS[item.service_type] ?? item.service_type}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{item.hsn_sac_code}</td>
                      <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground">
                        {item.period_from ? (
                          <span>{fmt(item.period_from)}{item.period_to ? ` – ${fmt(item.period_to)}` : ""}</span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">{item.quantity}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">{inr(item.rate_paise)}</td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">{inr(item.amount_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals */}
          <div className="mt-5 flex justify-end">
            <div className="w-full max-w-xs space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums text-foreground">{inr(invoice.subtotal_paise)}</span>
              </div>
              {invoice.is_inter_state ? (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">IGST (18%)</span>
                  <span className="tabular-nums text-foreground">{inr(invoice.igst_paise)}</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">CGST (9%)</span>
                    <span className="tabular-nums text-foreground">{inr(invoice.cgst_paise)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">SGST (9%)</span>
                    <span className="tabular-nums text-foreground">{inr(invoice.sgst_paise)}</span>
                  </div>
                </>
              )}
              <div className="mt-2 flex justify-between border-t border-border pt-2 text-base font-semibold">
                <span className="text-foreground">Grand Total</span>
                <span className="text-lg tabular-nums text-foreground">{inr(invoice.total_paise)}</span>
              </div>
              {(invoice.amount_paid_paise ?? 0) > 0 && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Amount Paid</span>
                    <span className="tabular-nums text-emerald-700 dark:text-emerald-300">({inr(invoice.amount_paid_paise)})</span>
                  </div>
                  <div className="flex justify-between border-t border-border pt-2 text-sm font-semibold">
                    <span className="text-foreground">Balance Due</span>
                    <span className="tabular-nums text-rose-700 dark:text-rose-300">{inr(invoice.balance_due_paise)}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>

        {/* Notes / Terms */}
        {(invoice.notes || invoice.terms_and_conditions) && (
          <section className="rounded-2xl border border-border bg-card card-elevated p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
              <span className="text-muted-foreground">
                <FileText className="h-4 w-4" />
              </span>
              <h2 className="text-sm font-semibold text-foreground">Notes &amp; Terms</h2>
            </div>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {invoice.notes && (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</p>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{invoice.notes}</p>
                </div>
              )}
              {invoice.terms_and_conditions && (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Terms &amp; Conditions</p>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{invoice.terms_and_conditions}</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Payment History */}
        {payments.length > 0 && (
          <section className="rounded-2xl border border-border bg-card card-elevated p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
              <span className="text-muted-foreground">
                <History className="h-4 w-4" />
              </span>
              <h2 className="text-sm font-semibold text-foreground">Payment History</h2>
            </div>
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left">Receipt #</th>
                      <th className="px-4 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-left">Mode</th>
                      <th className="px-4 py-3 text-left">Reference</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3 font-mono text-xs text-foreground">{p.receipt_number ?? "—"}</td>
                        <td className="px-4 py-3 tabular-nums text-muted-foreground">{fmt(p.payment_date)}</td>
                        <td className="px-4 py-3 text-foreground">{PM_LABELS[p.payment_mode] ?? p.payment_mode}</td>
                        <td className="px-4 py-3 text-muted-foreground">{p.reference_number ?? "—"}</td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums text-emerald-700 dark:text-emerald-300">{inr(p.amount_paise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
