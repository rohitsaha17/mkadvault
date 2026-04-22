// Site Detail Page — shows all site information, photos, landowner, contracts,
// and campaign booking history. Server component; fetches from Supabase.
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  MapPin,
  Ruler,
  Building,
  Edit,
  ScrollText,
  Megaphone,
  Plus,
  LineChart,
  Receipt,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type {
  Site,
  SitePhoto,
  UserRole,
  ExpenseCategory,
  ExpenseStatus,
  PaymentMode,
} from "@/lib/types/database";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { SitePhotoGallery } from "@/components/sites/SitePhotoGallery";
import { SiteAnalyticsPanel } from "@/components/sites/SiteAnalyticsPanel";
import { getSignedUrls } from "@/lib/supabase/signed-urls";
import { DeleteSiteButton } from "@/components/sites/DeleteSiteButton";
import { NewExpenseDialog } from "@/components/expenses/NewExpenseDialog";
import {
  ExpensesList,
  type ExpenseRow,
} from "@/components/expenses/ExpensesList";
import { getSiteAnalytics } from "@/lib/analytics/site-analytics";
import { format } from "date-fns";

const FINANCE_ROLES: UserRole[] = [
  "super_admin",
  "admin",
  "manager",
  "accounts",
];

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

// Format paise → INR string
function formatRate(paise: number | null): string {
  if (!paise) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

export default async function SiteDetailPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();

  // Fetch site
  const { data: siteData, error } = await supabase
    .from("sites")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (error || !siteData) notFound();
  const site = siteData as unknown as Site;

  // Caller's roles — gate the "Mark paid / approve / reject" actions in the
  // embedded expenses list.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: callerProfile } = user
    ? await supabase
        .from("profiles")
        .select("role, roles")
        .eq("id", user.id)
        .single()
    : { data: null };
  const callerRoles: UserRole[] =
    Array.isArray(callerProfile?.roles) && callerProfile!.roles!.length > 0
      ? (callerProfile!.roles as UserRole[])
      : callerProfile?.role
      ? [callerProfile.role as UserRole]
      : [];
  const canSettle = callerRoles.some((r) => FINANCE_ROLES.includes(r));

  // Fetch related data in parallel
  const [
    photosResult,
    landownerResult,
    contractsResult,
    campaignSitesResult,
    analytics,
    expensesResult,
  ] = await Promise.all([
      supabase
        .from("site_photos")
        .select("id, site_id, organization_id, photo_url, photo_type, is_primary, sort_order, created_at, updated_at, created_by")
        .eq("site_id", id)
        .order("is_primary", { ascending: false })
        .order("sort_order")
        .limit(20),
      // Landowner (only if linked)
      site.landowner_id
        ? supabase
            .from("landowners")
            .select("id, full_name, phone, email, city")
            .eq("id", site.landowner_id)
            .single()
        : Promise.resolve({ data: null }),
      // Contracts for this site
      supabase
        .from("contracts")
        .select("id, contract_type, landowner_id, agency_id, payment_model, rent_amount_paise, start_date, end_date, status")
        .eq("site_id", id)
        .is("deleted_at", null)
        .order("start_date", { ascending: false })
        .limit(20),
      // Campaign bookings
      supabase
        .from("campaign_sites")
        .select("id, campaign_id, start_date, end_date, status, site_rate_paise, campaigns(id, campaign_name, start_date, end_date, status, client_id, clients(company_name))")
        .eq("site_id", id)
        .order("start_date", { ascending: false })
        .limit(50),
      // Site analytics (last 365 days window)
      getSiteAnalytics(id),
      // Site expenses (latest 30)
      supabase
        .from("site_expenses")
        .select(
          `id, category, description, amount_paise, status, payee_name, payee_type,
           needed_by, paid_at, payment_mode, receipt_doc_urls, payment_proof_urls, created_at`,
        )
        .eq("site_id", id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

  const photos = (photosResult.data ?? []) as unknown as SitePhoto[];
  const landowner = landownerResult.data as { id: string; full_name: string; phone: string | null; email: string | null; city: string | null } | null;
  const contracts = (contractsResult.data ?? []) as Array<{
    id: string; contract_type: string; landowner_id: string | null; agency_id: string | null;
    payment_model: string; rent_amount_paise: number | null; start_date: string; end_date: string; status: string;
  }>;
  const campaignSites = (campaignSitesResult.data ?? []) as unknown as Array<{
    id: string; campaign_id: string; start_date: string; end_date: string; status: string; site_rate_paise: number | null;
    campaigns: { id: string; campaign_name: string; start_date: string; end_date: string; status: string; client_id: string; clients: { company_name: string } | null } | null;
  }>;

  // Expenses — cast to the ExpensesList row shape, attaching the current site.
  const rawExpenses = (expensesResult.data ?? []) as Array<{
    id: string;
    category: ExpenseCategory;
    description: string;
    amount_paise: number;
    status: ExpenseStatus;
    payee_name: string;
    payee_type: string;
    needed_by: string | null;
    paid_at: string | null;
    payment_mode: PaymentMode | null;
    receipt_doc_urls: string[] | null;
    payment_proof_urls: string[] | null;
    created_at: string;
  }>;
  const expenses: ExpenseRow[] = rawExpenses.map((e) => ({
    ...e,
    site: { id, name: site.name, site_code: site.site_code },
  }));

  // Resolve counterparty names for contracts
  const landownerIds = [...new Set(contracts.filter(c => c.landowner_id).map(c => c.landowner_id!))];
  const agencyIds = [...new Set(contracts.filter(c => c.agency_id).map(c => c.agency_id!))];

  const [landownersResult, agenciesResult] = await Promise.all([
    landownerIds.length > 0
      ? supabase.from("landowners").select("id, full_name").in("id", landownerIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    agencyIds.length > 0
      ? supabase.from("partner_agencies").select("id, agency_name").in("id", agencyIds)
      : Promise.resolve({ data: [] as { id: string; agency_name: string }[] }),
  ]);

  const landownerMap = new Map((landownersResult.data ?? []).map(l => [l.id, l.full_name]));
  const agencyMap = new Map((agenciesResult.data ?? []).map(a => [a.id, a.agency_name]));

  // site-photos is a PRIVATE bucket — generate short-lived signed URLs for
  // each photo so the browser can fetch them. Map is {storagePath → signedUrl}.
  const photoSignedUrls = await getSignedUrls(
    "site-photos",
    photos.map((p) => p.photo_url),
  );

  const mediaTypeLabel = site.media_type?.replace(/_/g, " ") ?? "—";
  const ownershipLabel = site.ownership_model ?? "—";

  return (
    <div className="max-w-5xl">
      {/* Breadcrumb + actions */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/sites"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Sites
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {site.name}
            </h1>
            <StatusBadge status={site.status} />
          </div>
          <p className="mt-0.5 font-mono text-sm text-muted-foreground">
            {site.site_code}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/sites/${id}/edit`}>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Edit className="h-4 w-4" />
              Edit
            </Button>
          </Link>
          <DeleteSiteButton siteId={id} siteName={site.name} redirectAfter />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column — key details */}
        <div className="space-y-6 lg:col-span-2">
          {/* Analytics & Insights */}
          <Section
            title="Analytics & Insights"
            icon={<LineChart className="h-4 w-4" />}
          >
            <SiteAnalyticsPanel analytics={analytics} />
          </Section>

          {/* Expenses / Payment requests */}
          <Section
            title="Expenses & Payment requests"
            icon={<Receipt className="h-4 w-4" />}
            action={
              <NewExpenseDialog
                sites={[
                  {
                    id,
                    name: site.name,
                    site_code: site.site_code,
                  },
                ]}
                defaultSiteId={id}
                triggerLabel="New request"
                triggerSize="sm"
              />
            }
          >
            <ExpensesList
              expenses={expenses}
              canSettle={canSettle}
              hideSiteColumn
              emptyMessage="No payment requests for this site yet."
            />
          </Section>

          {/* Photos */}
          <Section title="Photos" icon={<Building className="h-4 w-4" />}>
            <SitePhotoGallery
              siteId={id}
              photos={photos}
              signedUrls={photoSignedUrls}
            />
          </Section>

          {/* Location */}
          <Section title="Location" icon={<MapPin className="h-4 w-4" />}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <DetailItem label="Address" value={site.address} colSpan />
              <DetailItem label="City" value={site.city} />
              <DetailItem label="State" value={site.state} />
              {site.pincode && <DetailItem label="Pincode" value={site.pincode} />}
              {site.landmark && <DetailItem label="Landmark" value={site.landmark} />}
              {site.latitude && site.longitude && (
                <DetailItem
                  label="GPS"
                  value={`${site.latitude}, ${site.longitude}`}
                  colSpan
                />
              )}
            </dl>
            {site.latitude && site.longitude && (
              <a
                href={`https://maps.google.com/?q=${site.latitude},${site.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <MapPin className="h-3.5 w-3.5" />
                View on Google Maps
              </a>
            )}
          </Section>

          {/* Specifications */}
          <Section title="Specifications" icon={<Ruler className="h-4 w-4" />}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
              {site.width_ft && site.height_ft && (
                <DetailItem
                  label="Dimensions"
                  value={`${site.width_ft} × ${site.height_ft} ft`}
                />
              )}
              {site.total_sqft && (
                <DetailItem label="Total Area" value={`${site.total_sqft} sq.ft.`} />
              )}
              {site.illumination && (
                <DetailItem
                  label="Illumination"
                  value={site.illumination.charAt(0).toUpperCase() + site.illumination.slice(1)}
                />
              )}
              {site.facing && <DetailItem label="Facing" value={site.facing} />}
              {site.traffic_side && (
                <DetailItem
                  label="Traffic Side"
                  value={
                    site.traffic_side === "lhs"
                      ? "Left Hand Side"
                      : site.traffic_side === "rhs"
                      ? "Right Hand Side"
                      : "Both Sides"
                  }
                />
              )}
              {site.visibility_distance_m && (
                <DetailItem label="Visibility" value={`${site.visibility_distance_m} m`} />
              )}
              <DetailItem
                label="Structure"
                value={site.structure_type.charAt(0).toUpperCase() + site.structure_type.slice(1)}
              />
              <DetailItem
                label="Media Type"
                value={mediaTypeLabel.charAt(0).toUpperCase() + mediaTypeLabel.slice(1)}
              />
            </dl>
          </Section>

          {/* Contracts */}
          <Section
            title="Contracts"
            icon={<ScrollText className="h-4 w-4" />}
            action={
              <Link href={`/contracts/new?site_id=${id}`}>
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  New Contract
                </Button>
              </Link>
            }
          >
            {contracts.length === 0 ? (
              <div className="py-4 text-center">
                <p className="text-sm text-muted-foreground">
                  No contracts linked to this site yet.
                </p>
                <Link href={`/contracts/new?site_id=${id}`}>
                  <Button size="sm" variant="outline" className="mt-3 gap-1.5">
                    <Plus className="h-3.5 w-3.5" />
                    Create First Contract
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-border -mx-1">
                {contracts.map((c) => {
                  const counterparty = c.contract_type === "agency"
                    ? agencyMap.get(c.agency_id ?? "") ?? "Unknown Agency"
                    : landownerMap.get(c.landowner_id ?? "") ?? "Unknown Landowner";
                  return (
                    <Link
                      key={c.id}
                      href={`/contracts/${c.id}`}
                      className="flex items-center justify-between gap-3 px-1 py-3 rounded-lg hover:bg-muted/40 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {counterparty}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {c.payment_model?.replace(/_/g, " ")} · {format(new Date(c.start_date), "dd MMM yyyy")} — {format(new Date(c.end_date), "dd MMM yyyy")}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-sm font-semibold tabular-nums text-foreground">
                          {formatRate(c.rent_amount_paise)}/mo
                        </span>
                        <StatusBadge status={c.status} />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </Section>

          {/* Campaign Bookings */}
          <Section
            title="Campaign Bookings"
            icon={<Megaphone className="h-4 w-4" />}
            action={
              <Link href={`/campaigns/new?site_id=${id}`}>
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  Book Campaign
                </Button>
              </Link>
            }
          >
            {campaignSites.length === 0 ? (
              <div className="py-4 text-center">
                <p className="text-sm text-muted-foreground">
                  No campaigns have booked this site yet.
                </p>
                <Link href={`/campaigns/new?site_id=${id}`}>
                  <Button size="sm" variant="outline" className="mt-3 gap-1.5">
                    <Plus className="h-3.5 w-3.5" />
                    Book a Campaign
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-border -mx-1">
                {campaignSites.map((cs) => {
                  const camp = cs.campaigns;
                  if (!camp) return null;
                  return (
                    <Link
                      key={cs.id}
                      href={`/campaigns/${camp.id}`}
                      className="flex items-center justify-between gap-3 px-1 py-3 rounded-lg hover:bg-muted/40 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {camp.campaign_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {camp.clients?.company_name ?? "—"} · {format(new Date(cs.start_date), "dd MMM yyyy")} — {format(new Date(cs.end_date), "dd MMM yyyy")}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-sm font-semibold tabular-nums text-foreground">
                          {formatRate(cs.site_rate_paise)}
                        </span>
                        <StatusBadge status={camp.status} />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </Section>
        </div>

        {/* Right column — sidebar cards */}
        <div className="space-y-4">
          {/* Landowner */}
          {site.ownership_model === "owned" && (
            <SidebarCard title="Landowner">
              {landowner ? (
                <div className="space-y-1">
                  <Link
                    href={`/landowners/${landowner.id}`}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    {landowner.full_name}
                  </Link>
                  {landowner.phone && (
                    <p className="text-xs text-muted-foreground">{landowner.phone}</p>
                  )}
                  {landowner.email && (
                    <p className="text-xs text-muted-foreground">{landowner.email}</p>
                  )}
                  {landowner.city && (
                    <p className="text-xs text-muted-foreground">{landowner.city}</p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Not linked to a landowner. Edit the site to assign one.
                </p>
              )}
            </SidebarCard>
          )}

          {/* Commercial Details */}
          <SidebarCard title="Commercial Details">
            <SidebarRow label="Monthly Rate">
              <span className="font-semibold tabular-nums text-foreground">
                {formatRate(site.base_rate_paise)}
              </span>
            </SidebarRow>
            <SidebarRow label="Ownership">
              <span className="capitalize text-foreground">{ownershipLabel}</span>
            </SidebarRow>
            {site.municipal_permission_number && (
              <SidebarRow label="Permit No.">
                <span className="font-mono text-xs text-foreground">
                  {site.municipal_permission_number}
                </span>
              </SidebarRow>
            )}
            {site.municipal_permission_expiry && (
              <SidebarRow label="Permit Expiry">
                <span className="tabular-nums text-foreground">
                  {format(new Date(site.municipal_permission_expiry), "dd MMM yyyy")}
                </span>
              </SidebarRow>
            )}
          </SidebarCard>

          {/* Quick Info */}
          <SidebarCard title="Quick Info">
            <SidebarRow label="Status">
              <StatusBadge status={site.status} />
            </SidebarRow>
            <SidebarRow label="Type">
              <span className="capitalize text-foreground">{mediaTypeLabel}</span>
            </SidebarRow>
            <SidebarRow label="Added">
              <span className="tabular-nums text-foreground">
                {format(new Date(site.created_at), "dd MMM yyyy")}
              </span>
            </SidebarRow>
            <SidebarRow label="Last Updated">
              <span className="tabular-nums text-foreground">
                {format(new Date(site.updated_at), "dd MMM yyyy")}
              </span>
            </SidebarRow>
          </SidebarCard>

          {/* Notes */}
          {site.notes && (
            <div className="rounded-2xl border border-border bg-card card-elevated p-5">
              <h3 className="mb-2 text-sm font-semibold text-foreground">Notes</h3>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {site.notes}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Helper components ────────────────────────────────────────────────────────

function Section({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  // Optional right-aligned action slot in the section header (e.g. a "New"
  // button that opens a create flow scoped to this entity).
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card card-elevated p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        </div>
        {action}
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

function DetailItem({
  label,
  value,
  colSpan,
}: {
  label: string;
  value: string | number | null | undefined;
  colSpan?: boolean;
}) {
  if (!value) return null;
  return (
    <div className={colSpan ? "col-span-2" : ""}>
      <dt className="mb-0.5 text-xs text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
