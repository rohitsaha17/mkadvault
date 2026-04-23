import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft, Pencil, MapPin, Calendar, User, FileText, Wrench, Wallet,
} from "lucide-react";
import { CampaignStatusBar } from "@/components/campaigns/CampaignStatusBar";
import { CampaignDetailActions } from "@/components/campaigns/CampaignDetailActions";
import { ChangeRequestButton } from "@/components/campaigns/ChangeRequestButton";
import { ChangeRequestsTab } from "@/components/campaigns/ChangeRequestsTab";
import { CampaignJobsTab } from "@/components/campaigns/CampaignJobsTab";
import { CampaignActivityTimeline, type ActivityEntry } from "@/components/campaigns/CampaignActivityTimeline";
import { SitePreviewModal } from "@/components/sites/SitePreviewModal";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { fmt, inr } from "@/lib/utils";
import type {
  Campaign, Client, CampaignSite, CampaignService, CampaignActivityLog, CampaignChangeRequest, CampaignJob, Site, ServiceType,
} from "@/lib/types/database";

const SERVICE_TYPE_LABELS: Record<string, string> = {
  display_rental: "Display Rental",
  flex_printing: "Flex Printing",
  mounting: "Mounting",
  design: "Design",
  transport: "Transport",
  other: "Other",
};

interface CampaignSiteWithSite extends CampaignSite {
  site?: Pick<Site, "id" | "name" | "site_code" | "city"> | null;
}

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { tab = "sites" } = await searchParams;

  const supabase = await createClient();

  const { data: campData } = await supabase
    .from("campaigns")
    .select("*, client:clients(id, company_name, brand_name, primary_contact_name, primary_contact_phone)")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!campData) notFound();

  const campaign = campData as unknown as Campaign & {
    client?: Pick<Client, "id" | "company_name" | "brand_name" | "primary_contact_name" | "primary_contact_phone"> | null;
  };

  // Current user role(s) for role-based UI (cached per request). Uses the
  // roles[] array when present (multi-role users) and falls back to primary
  // role so single-role profiles still work.
  const session = await getSession();
  const userRoles: string[] =
    session?.profile?.roles && session.profile.roles.length > 0
      ? session.profile.roles
      : [session?.profile?.role ?? "viewer"];

  // Fetch related data in parallel
  const [
    { data: campSitesData },
    { data: campServicesData },
    { data: activityData },
    { data: invoicesData },
    { data: changeRequestsData },
    { data: jobsData },
    { data: agenciesData },
  ] = await Promise.all([
    supabase
      .from("campaign_sites")
      .select("*, site:sites(id, name, site_code, city)")
      .eq("campaign_id", id)
      .order("created_at"),
    supabase
      .from("campaign_services")
      .select("*")
      .eq("campaign_id", id)
      .order("created_at"),
    // Activity log with the actor profile joined — the timeline
     // surfaces who made each change, so we pull full_name alongside
     // user_id rather than doing N+1 profile lookups client-side.
    supabase
      .from("campaign_activity_log")
      .select("*, actor:profiles!campaign_activity_log_user_id_fkey(id, full_name)")
      .eq("campaign_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("invoices")
      .select("id, invoice_number, invoice_date, due_date, total_paise, status")
      .eq("campaign_id", id)
      .order("invoice_date", { ascending: false }),
    supabase
      .from("campaign_change_requests")
      .select("*")
      .eq("campaign_id", id)
      .order("requested_at", { ascending: false }),
    // Print / mount jobs for this campaign (new Jobs tab)
    supabase
      .from("campaign_jobs")
      .select("*")
      .eq("campaign_id", id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    // Agencies in the org — used as vendor options in the "Add job" dialog
    supabase
      .from("partner_agencies")
      .select("id, agency_name")
      .is("deleted_at", null)
      .order("agency_name"),
  ]);

  const campSites = (campSitesData ?? []) as unknown as CampaignSiteWithSite[];
  const campServices = (campServicesData ?? []) as unknown as CampaignService[];
  // Activity log rows carry a joined `actor` (user_id → profiles), so we
  // widen the local shape for the timeline component. The raw CampaignActivityLog
  // type is still used for any future places that need the plain row.
  const activity = (activityData ?? []) as unknown as (CampaignActivityLog & {
    actor?: { id: string; full_name: string | null } | null;
  })[];
  const activityEntries: ActivityEntry[] = activity.map((e) => ({
    id: e.id,
    created_at: e.created_at,
    action: e.action,
    description: e.description,
    old_value: e.old_value,
    new_value: e.new_value,
    actor: e.actor ?? null,
  }));
  const invoices = (invoicesData ?? []) as Array<{
    id: string; invoice_number: string; invoice_date: string; due_date: string; total_paise: number; status: string;
  }>;
  const changeRequests = (changeRequestsData ?? []) as unknown as CampaignChangeRequest[];
  const jobs = (jobsData ?? []) as unknown as CampaignJob[];
  const agencyOptions = (agenciesData ?? []) as Array<{ id: string; agency_name: string }>;
  const hasPendingChangeRequest = changeRequests.some((r) => r.status === "pending");

  // Site options for the "Add job" dialog — each campaign_site becomes a
  // picker option. The dialog can also leave the site blank for
  // campaign-wide jobs (e.g. a bulk print order spanning multiple sites).
  const siteOptions = campSites
    .filter((cs) => cs.site)
    .map((cs) => ({
      campaign_site_id: cs.id,
      site_id: cs.site!.id,
      site_name: cs.site!.name,
      site_code: cs.site!.site_code ?? null,
    }));

  // Roles that can edit jobs: admins, managers, and executives (ops team
  // who actually schedule print/mount work). Accounts can view but
  // approval of linked payment requests happens in the Finance module.
  const canEditJobs = userRoles.some((r) =>
    ["super_admin", "admin", "manager", "executive"].includes(r),
  );

  // Financials
  const sitesTotal = campSites.reduce((sum, cs) => sum + (cs.display_rate_paise ?? 0), 0);
  const servicesTotal = campServices.reduce((sum, cs) => sum + (cs.total_paise ?? 0), 0);
  const totalValue = campaign.total_value_paise ?? (sitesTotal + servicesTotal);

  const TABS = [
    { key: "sites", label: `Sites (${campSites.length})` },
    { key: "services", label: `Services (${campServices.length})` },
    { key: "jobs", label: `Jobs (${jobs.length})` },
    { key: "invoices", label: `Invoices (${invoices.length})` },
    { key: "financials", label: "Financials" },
    { key: "activity", label: "Activity" },
    ...(changeRequests.length > 0 ? [{ key: "changes", label: `Changes (${changeRequests.length})` }] : []),
  ];

  return (
    <div className="max-w-6xl">
      {/* Breadcrumb + actions */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/campaigns"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Campaigns
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {campaign.campaign_name}
            </h1>
            <StatusBadge status={campaign.status} />
            {campaign.campaign_code && (
              <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                {campaign.campaign_code}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            {campaign.client && (
              <Link
                href={`/clients/${campaign.client.id}`}
                className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <User className="h-3.5 w-3.5" />
                {campaign.client.company_name}
              </Link>
            )}
            {(campaign.start_date || campaign.end_date) && (
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {fmt(campaign.start_date)} – {fmt(campaign.end_date)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CampaignDetailActions
            campaignId={id}
            campaignStatus={campaign.status}
            clientId={campaign.client_id ?? ""}
            currentEndDate={campaign.end_date}
          />
          {/* Direct edit for early stages; change request for confirmed+ */}
          {["enquiry", "proposal_sent"].includes(campaign.status) ? (
            <Link href={`/campaigns/${id}/edit`}>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            </Link>
          ) : !["cancelled", "completed", "dismounted"].includes(campaign.status) ? (
            <ChangeRequestButton campaignId={id} hasPendingRequest={hasPendingChangeRequest} />
          ) : null}
        </div>
      </div>

      {/* Pending change request banner */}
      {hasPendingChangeRequest && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-3">
          <span className="text-sm text-amber-700 dark:text-amber-300">
            A change request is pending approval. Editing will be unlocked once approved.
          </span>
        </div>
      )}

      {/* Status bar */}
      <div className="mb-6">
        <CampaignStatusBar
          campaignId={id}
          currentStatus={campaign.status}
          serviceTypes={[...new Set(campServices.map((s) => s.service_type))] as ServiceType[]}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Tabs */}
          <section className="rounded-2xl border border-border bg-card card-elevated p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-1 border-b border-border overflow-x-auto">
              {TABS.map((t) => (
                <Link
                  key={t.key}
                  href={`/campaigns/${id}?tab=${t.key}`}
                  className={`px-3 py-2 -mb-px border-b-2 text-sm font-medium whitespace-nowrap transition-colors ${
                    tab === t.key
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                </Link>
              ))}
            </div>

            {/* Sites tab */}
            {tab === "sites" && (
              campSites.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border py-10 text-center">
                  <MapPin className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" />
                  <p className="text-sm text-muted-foreground">No sites added to this campaign.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Site</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Dates</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Rate</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {campSites.map((cs) => (
                        <tr key={cs.id} className="hover:bg-muted/50 transition-colors">
                          <td className="px-4 py-3">
                            {cs.site ? (
                              <>
                                <SitePreviewModal siteId={cs.site.id}>
                                  <span className="font-medium text-foreground hover:text-primary hover:underline text-left cursor-pointer">
                                    {cs.site.name}
                                  </span>
                                </SitePreviewModal>
                                <p className="text-xs font-mono text-muted-foreground">
                                  {cs.site.site_code} · {cs.site.city}
                                </p>
                              </>
                            ) : (
                              <span className="text-xs font-mono text-muted-foreground">{cs.site_id}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                            {fmt(cs.start_date)} – {fmt(cs.end_date)}
                          </td>
                          <td className="px-4 py-3 text-foreground tabular-nums">{inr(cs.display_rate_paise)}</td>
                          <td className="px-4 py-3">
                            <StatusBadge status={cs.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {/* Services tab */}
            {tab === "services" && (
              campServices.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border py-10 text-center">
                  <Wrench className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" />
                  <p className="text-sm text-muted-foreground">No services added.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Service</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Qty</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Rate</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {campServices.map((cs) => (
                        <tr key={cs.id} className="hover:bg-muted/50 transition-colors">
                          <td className="px-4 py-3">
                            <p className="font-medium text-foreground">
                              {SERVICE_TYPE_LABELS[cs.service_type] ?? cs.service_type}
                            </p>
                            {cs.description && (
                              <p className="mt-0.5 text-xs text-muted-foreground">{cs.description}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground tabular-nums">{cs.quantity}</td>
                          <td className="px-4 py-3 text-foreground tabular-nums">{inr(cs.rate_paise)}</td>
                          <td className="px-4 py-3 font-medium text-foreground tabular-nums">{inr(cs.total_paise)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {/* Jobs tab */}
            {tab === "jobs" && (
              <CampaignJobsTab
                campaignId={id}
                jobs={jobs}
                siteOptions={siteOptions}
                agencyOptions={agencyOptions}
                canEdit={canEditJobs}
              />
            )}

            {/* Invoices tab */}
            {tab === "invoices" && (
              invoices.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border py-10 text-center">
                  <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" />
                  <p className="text-sm text-muted-foreground">No invoices generated for this campaign yet.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Invoice #</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Date</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Due</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Amount</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {invoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-muted/50 transition-colors">
                          <td className="px-4 py-3">
                            <Link href={`/billing/invoices/${inv.id}`} className="font-mono font-medium text-foreground hover:text-primary hover:underline">
                              {inv.invoice_number}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">{fmt(inv.invoice_date)}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">{fmt(inv.due_date)}</td>
                          <td className="px-4 py-3 text-foreground tabular-nums">{inr(inv.total_paise)}</td>
                          <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {/* Financials tab */}
            {tab === "financials" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl border border-border bg-card p-4">
                    <p className="text-xs text-muted-foreground">Total Sites</p>
                    <p className="mt-1 text-2xl font-semibold text-foreground tabular-nums">{campSites.length}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-4">
                    <p className="text-xs text-muted-foreground">Total Services</p>
                    <p className="mt-1 text-2xl font-semibold text-foreground tabular-nums">{campServices.length}</p>
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-card p-5 space-y-3 text-sm">
                  {campaign.pricing_type === "itemized" ? (
                    <>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Sites ({campSites.length})</span>
                        <span className="tabular-nums text-foreground">{inr(sitesTotal)}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Services ({campServices.length})</span>
                        <span className="tabular-nums text-foreground">{inr(servicesTotal)}</span>
                      </div>
                      <div className="flex justify-between font-semibold text-foreground border-t border-border pt-3">
                        <span>Total</span>
                        <span className="tabular-nums">{inr(totalValue)}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between font-semibold text-foreground">
                      <span>Bundled Campaign Value</span>
                      <span className="tabular-nums">{inr(campaign.total_value_paise)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Activity tab */}
            {tab === "activity" && (
              <CampaignActivityTimeline entries={activityEntries} />
            )}

            {/* Change Requests tab */}
            {tab === "changes" && (
              <ChangeRequestsTab requests={changeRequests} userRoles={userRoles} />
            )}
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card card-elevated p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Wallet className="h-4 w-4 text-muted-foreground" />
              Summary
            </h3>
            <dl className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Pricing</dt>
                <dd className="capitalize text-foreground">{campaign.pricing_type}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Sites</dt>
                <dd className="tabular-nums text-foreground">{campSites.length}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Services</dt>
                <dd className="tabular-nums text-foreground">{campServices.length}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border pt-2.5">
                <dt className="text-muted-foreground">Total Value</dt>
                <dd className="font-semibold tabular-nums text-foreground">{inr(totalValue)}</dd>
              </div>
            </dl>
          </div>

          {campaign.client && (
            <div className="rounded-2xl border border-border bg-card card-elevated p-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <User className="h-4 w-4 text-muted-foreground" />
                Client
              </h3>
              <Link
                href={`/clients/${campaign.client.id}`}
                className="block text-sm font-medium text-foreground hover:text-primary hover:underline"
              >
                {campaign.client.company_name}
              </Link>
              {campaign.client.primary_contact_name && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {campaign.client.primary_contact_name}
                </p>
              )}
              {campaign.client.primary_contact_phone && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  {campaign.client.primary_contact_phone}
                </p>
              )}
            </div>
          )}

          {campaign.notes && (
            <div className="rounded-2xl border border-border bg-card card-elevated p-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Notes
              </h3>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {campaign.notes}
              </p>
            </div>
          )}

          <p className="px-1 text-xs text-muted-foreground tabular-nums">
            Created {fmt(campaign.created_at)}
          </p>
        </div>
      </div>
    </div>
  );
}
