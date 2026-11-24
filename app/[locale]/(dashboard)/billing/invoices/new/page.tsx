import { setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";
import { InvoiceForm } from "@/components/billing/InvoiceForm";
import { PageHeader } from "@/components/shared/PageHeader";
import type { Client, Campaign, OrganizationBankAccount, PartnerAgency } from "@/lib/types/database";

export const metadata = { title: "Create Invoice" };

type InvoiceClient = Pick<Client,
  "id" | "company_name" | "brand_name" | "gstin" | "credit_terms" |
  "billing_address" | "billing_city" | "billing_state"
>;

type InvoiceCampaign = Pick<Campaign,
  "id" | "campaign_name" | "client_id" | "pricing_type" | "total_value_paise" |
  "billing_party_type" | "billed_agency_id"
>;

type InvoiceAgency = Pick<PartnerAgency, "id" | "agency_name" | "gstin" | "state">;

export default async function NewInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    client_id?: string;
    agency_id?: string;
    bill_to?: "client" | "agency";
    campaign_id?: string;
    // Optional billing window — pre-selects line-item period dates so
    // the invoice ships with per-site amounts already pro-rated for
    // the chosen range. Driven by the "extend campaign" flow.
    period_from?: string;
    period_to?: string;
  }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { client_id, agency_id, bill_to, campaign_id, period_from, period_to } =
    await searchParams;

  const supabase = await createClient();

  // Verify auth (cached per request)
  const session = await getSession();
  if (!session) redirect("/login");
  const { profile } = session;
  if (!profile?.org_id) redirect("/login");

  const [
    { data: clientsData },
    { data: campaignsData },
    { data: agenciesData },
    { data: orgData },
    { data: bankAccountsData },
  ] = await Promise.all([
    supabase
      .from("clients")
      .select("id, company_name, brand_name, gstin, credit_terms, billing_address, billing_city, billing_state")
      .is("deleted_at", null)
      .order("company_name"),
    supabase
      .from("campaigns")
      .select("id, campaign_name, client_id, pricing_type, total_value_paise, billing_party_type, billed_agency_id")
      .is("deleted_at", null)
      .in("status", ["live", "completed"])
      .order("campaign_name"),
    supabase
      .from("partner_agencies")
      .select("id, agency_name, gstin, state")
      .is("deleted_at", null)
      .order("agency_name"),
    supabase
      .from("organizations")
      .select("gstin, settings")
      .eq("id", profile.org_id)
      .single(),
    supabase
      .from("organization_bank_accounts")
      .select("id, label, bank_name, account_number, ifsc_code, branch_name, is_primary")
      .eq("organization_id", profile.org_id)
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true }),
  ]);

  const clients = (clientsData ?? []) as InvoiceClient[];
  const campaigns = (campaignsData ?? []) as InvoiceCampaign[];
  const agencies = (agenciesData ?? []) as InvoiceAgency[];
  const orgGstin = orgData?.gstin ?? null;
  const orgSettings = (orgData?.settings ?? {}) as Record<string, string>;

  // Invoice T&C default source order (migration 040):
  //   1. organizations.invoice_terms_template (new per-doc column)
  //   2. organizations.settings.default_payment_terms  (legacy JSON key)
  //   3. hardcoded fallback
  // Fetched in a separate query so a missing 040 column can't nuke the
  // main org fetch above.
  const invoiceTermsTemplate: string | null = await (async () => {
    const { data, error } = await supabase
      .from("organizations")
      .select("invoice_terms_template")
      .eq("id", profile.org_id)
      .maybeSingle();
    if (error || !data) return null;
    return (data as { invoice_terms_template?: string | null }).invoice_terms_template ?? null;
  })();
  const defaultTerms =
    invoiceTermsTemplate ??
    orgSettings.default_payment_terms ??
    "Payment due within the agreed credit period. Please quote the invoice number in your payment.";
  const bankAccounts = (bankAccountsData ?? []) as Pick<
    OrganizationBankAccount,
    "id" | "label" | "bank_name" | "account_number" | "ifsc_code" | "branch_name" | "is_primary"
  >[];

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        eyebrow="Billing"
        title="Create Invoice"
        description="Fill in the details below to create a new GST invoice."
      />
      <InvoiceForm
        clients={clients}
        campaigns={campaigns}
        agencies={agencies}
        orgGstin={orgGstin}
        defaultTerms={defaultTerms}
        bankAccounts={bankAccounts}
        preselectedClientId={client_id}
        preselectedAgencyId={agency_id}
        preselectedBillTo={bill_to ?? (agency_id ? "agency" : undefined)}
        preselectedCampaignId={campaign_id}
        preselectedPeriodFrom={period_from}
        preselectedPeriodTo={period_to}
      />
    </div>
  );
}
