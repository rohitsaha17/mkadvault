import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { inr, fmt } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft, Phone, Mail, MapPin, FileText, Pencil, Building2, Users, Receipt, CreditCard,
} from "lucide-react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { Client, Campaign, Invoice, PaymentReceived } from "@/lib/types/database";

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("clients");
  const { tab = "campaigns" } = await searchParams;

  const supabase = await createClient();

  const { data } = await supabase
    .from("clients").select("*").eq("id", id).is("deleted_at", null).single();

  if (!data) notFound();
  const clientData = data as unknown as Client;

  // Fetch campaigns, invoices, and payments in parallel
  const [campaignsResult, invoicesResult, paymentsResult] = await Promise.all([
    supabase
      .from("campaigns")
      .select("id, campaign_name, campaign_code, start_date, end_date, status, total_value_paise, created_at")
      .eq("client_id", id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("invoices")
      .select("id, invoice_number, invoice_date, due_date, total_paise, status")
      .eq("client_id", id)
      .order("invoice_date", { ascending: false })
      .limit(50),
    supabase
      .from("payments_received")
      .select("id, amount_paise, payment_date, payment_mode, reference_number")
      .eq("client_id", id)
      .order("payment_date", { ascending: false })
      .limit(50),
  ]);
  const campaigns = (campaignsResult.data ?? []) as unknown as Campaign[];
  const invoices = (invoicesResult.data ?? []) as Array<{
    id: string; invoice_number: string; invoice_date: string; due_date: string; total_paise: number; status: string;
  }>;
  const payments = (paymentsResult.data ?? []) as Array<{
    id: string; amount_paise: number; payment_date: string; payment_mode: string; reference_number: string | null;
  }>;

  const activeCampaigns = campaigns.filter((c) => c.status === "live");
  const lifetimeRevenue = campaigns.reduce((sum, c) => sum + (c.total_value_paise ?? 0), 0);

  const TABS = [
    { key: "campaigns", label: t("tabs.campaigns") },
    { key: "invoices", label: "Invoices" },
    { key: "payments", label: "Payments" },
    { key: "financials", label: t("tabs.financials") },
  ];

  return (
    <div className="max-w-5xl">
      {/* Breadcrumb + actions */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/clients"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            {t("backToClients")}
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {clientData.company_name}
            </h1>
          </div>
          {clientData.brand_name && (
            <p className="mt-0.5 text-sm text-muted-foreground">Brand: {clientData.brand_name}</p>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">
            {activeCampaigns.length} active campaign{activeCampaigns.length !== 1 ? "s" : ""} ·
            Lifetime revenue: <span className="tabular-nums">{inr(lifetimeRevenue)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/campaigns/new?client_id=${id}`}>
            <Button size="sm">+ New Campaign</Button>
          </Link>
          <Link href={`/clients/${id}/edit`}>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left */}
        <div className="space-y-6 lg:col-span-2">

          {/* Contacts */}
          <Section title="Contacts" icon={<Users className="h-4 w-4" />}>
            <div className="grid grid-cols-1 gap-4 text-sm">
              {[
                { label: "Primary", name: clientData.primary_contact_name, phone: clientData.primary_contact_phone, email: clientData.primary_contact_email },
                { label: "Secondary", name: clientData.secondary_contact_name, phone: clientData.secondary_contact_phone, email: clientData.secondary_contact_email },
                { label: "Billing", name: clientData.billing_contact_name, phone: clientData.billing_contact_phone, email: clientData.billing_contact_email },
              ].filter((c) => c.name || c.phone || c.email).map((contact) => (
                <div key={contact.label} className="flex gap-3">
                  <span className="w-16 shrink-0 pt-0.5 text-xs text-muted-foreground">{contact.label}</span>
                  <div>
                    {contact.name && <p className="font-medium text-foreground">{contact.name}</p>}
                    {contact.phone && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Phone className="h-3 w-3" />
                        {contact.phone}
                      </div>
                    )}
                    {contact.email && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Mail className="h-3 w-3" />
                        {contact.email}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {!clientData.primary_contact_name && !clientData.primary_contact_phone && !clientData.primary_contact_email && (
                <p className="text-sm text-muted-foreground">No contact information on record.</p>
              )}
            </div>
          </Section>

          {/* Billing info */}
          <Section title="Billing Details" icon={<Building2 className="h-4 w-4" />}>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">GSTIN</p>
                <p className="mt-0.5 font-mono font-medium text-foreground">{clientData.gstin ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">PAN</p>
                <p className="mt-0.5 font-mono font-medium text-foreground">{clientData.pan ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Credit Terms</p>
                <p className="mt-0.5 font-medium capitalize text-foreground">{clientData.credit_terms.replace(/net/, "Net ")}</p>
              </div>
            </div>
            {(clientData.billing_address || clientData.billing_city) && (
              <div className="mt-3 flex items-start gap-1.5 border-t border-border pt-3 text-sm text-foreground">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span>
                  {[clientData.billing_address, clientData.billing_city, clientData.billing_state, clientData.billing_pin_code]
                    .filter(Boolean).join(", ")}
                </span>
              </div>
            )}
          </Section>

          {/* Notes */}
          {clientData.notes && (
            <Section title="Notes" icon={<FileText className="h-4 w-4" />}>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{clientData.notes}</p>
            </Section>
          )}

          {/* Campaigns / Financials tabs */}
          <div>
            <div className="mb-4 flex gap-1 border-b border-border">
              {TABS.map((tabItem) => (
                <Link
                  key={tabItem.key}
                  href={`/clients/${id}?tab=${tabItem.key}`}
                  className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                    tab === tabItem.key
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tabItem.label}
                </Link>
              ))}
            </div>

            {tab === "campaigns" && (
              campaigns.length === 0 ? (
                <div className="rounded-2xl border border-border bg-card card-elevated py-8 text-center">
                  <p className="text-sm text-muted-foreground">No campaigns yet.</p>
                  <Link href={`/campaigns/new?client_id=${id}`}>
                    <Button size="sm" className="mt-3">Create Campaign</Button>
                  </Link>
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-border bg-card card-elevated">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border bg-muted">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Campaign</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Dates</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Value</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {campaigns.map((c) => (
                        <tr key={c.id} className="hover:bg-muted">
                          <td className="px-4 py-2.5">
                            <Link href={`/campaigns/${c.id}`} className="font-medium text-foreground hover:text-primary hover:underline">
                              {c.campaign_name}
                            </Link>
                            {c.campaign_code && (
                              <p className="font-mono text-xs text-muted-foreground">{c.campaign_code}</p>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums">
                            {fmt(c.start_date)} – {fmt(c.end_date)}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums text-foreground">{inr(c.total_value_paise)}</td>
                          <td className="px-4 py-2.5">
                            <StatusBadge status={c.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {tab === "invoices" && (
              invoices.length === 0 ? (
                <div className="rounded-2xl border border-border bg-card card-elevated py-8 text-center">
                  <p className="text-sm text-muted-foreground">No invoices yet for this client.</p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-border bg-card card-elevated">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border bg-muted">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Invoice #</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Date</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Due</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Amount</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {invoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-muted">
                          <td className="px-4 py-2.5">
                            <Link href={`/billing/invoices/${inv.id}`} className="font-mono font-medium text-foreground hover:text-primary hover:underline">
                              {inv.invoice_number}
                            </Link>
                          </td>
                          <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{fmt(inv.invoice_date)}</td>
                          <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{fmt(inv.due_date)}</td>
                          <td className="px-4 py-2.5 tabular-nums text-foreground">{inr(inv.total_paise)}</td>
                          <td className="px-4 py-2.5"><StatusBadge status={inv.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {tab === "payments" && (
              payments.length === 0 ? (
                <div className="rounded-2xl border border-border bg-card card-elevated py-8 text-center">
                  <p className="text-sm text-muted-foreground">No payments received from this client yet.</p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-border bg-card card-elevated">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border bg-muted">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Date</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Amount</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Mode</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Reference</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {payments.map((p) => (
                        <tr key={p.id} className="hover:bg-muted">
                          <td className="px-4 py-2.5 tabular-nums text-foreground">{fmt(p.payment_date)}</td>
                          <td className="px-4 py-2.5 tabular-nums text-foreground">{inr(p.amount_paise)}</td>
                          <td className="px-4 py-2.5 capitalize text-muted-foreground">{p.payment_mode.replace(/_/g, " ")}</td>
                          <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{p.reference_number ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {tab === "financials" && (
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-2xl border border-border bg-card card-elevated p-4 text-center">
                  <p className="text-xs text-muted-foreground">Total Campaigns</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{campaigns.length}</p>
                </div>
                <div className="rounded-2xl border border-border bg-card card-elevated p-4 text-center">
                  <p className="text-xs text-muted-foreground">Lifetime Revenue</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{inr(lifetimeRevenue)}</p>
                </div>
                <div className="rounded-2xl border border-border bg-card card-elevated p-4 text-center">
                  <p className="text-xs text-muted-foreground">Active Campaigns</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{activeCampaigns.length}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          <SidebarCard title="Summary">
            <SidebarRow label="Industry">
              <span className="text-foreground">{clientData.industry_category ?? "—"}</span>
            </SidebarRow>
            <SidebarRow label="Credit Terms">
              <span className="capitalize text-foreground">{clientData.credit_terms.replace(/net/, "Net ")}</span>
            </SidebarRow>
            <SidebarRow label="Total Campaigns">
              <span className="tabular-nums text-foreground">{campaigns.length}</span>
            </SidebarRow>
            <SidebarRow label="Lifetime Revenue">
              <span className="font-semibold tabular-nums text-foreground">{inr(lifetimeRevenue)}</span>
            </SidebarRow>
          </SidebarCard>
          <p className="text-xs text-muted-foreground">Added <span className="tabular-nums">{fmt(clientData.created_at)}</span></p>
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
