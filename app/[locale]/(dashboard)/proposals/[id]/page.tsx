import { setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";
import { getSignedUrls } from "@/lib/supabase/signed-urls";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, Edit, FileText, MapPin } from "lucide-react";
import { ProposalActions } from "@/components/proposals/ProposalActions";
import { ProposalExportButtons } from "@/components/proposals/ProposalExportButtons";
import { inr } from "@/lib/utils";
import type { Proposal, ProposalSite, Site, Organization } from "@/lib/types/database";
import type { SiteForProposal } from "../new/page";

export const metadata = { title: "Proposal" };

// Proposal-specific status tones (proposal statuses are not in the shared
// StatusBadge map yet, so we keep a small dark-mode-safe palette here).
const STATUS_TONE: Record<string, string> = {
  draft:
    "bg-muted text-foreground border-border dark:bg-white/5 dark:text-muted-foreground dark:border-white/10",
  sent:
    "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30",
  viewed:
    "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30",
  accepted:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30",
  rejected:
    "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30",
};

function displayRate(paise: number | null, showRates: string): string {
  if (!paise) return "—";
  if (showRates === "hidden") return "Hidden";
  if (showRates === "request_quote") return "Request Quote";
  if (showRates === "range") {
    const low = Math.round(paise * 0.8 / 100);
    const high = Math.round(paise * 1.2 / 100);
    const fmt = (v: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
    return `${fmt(low)} – ${fmt(high)}`;
  }
  return inr(paise);
}

export default async function ProposalDetailPage({
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

  const [
    { data: proposalData },
    { data: proposalSitesData },
    { data: orgData },
  ] = await Promise.all([
    supabase
      .from("proposals")
      .select("*, client:clients(id, company_name)")
      .eq("id", id)
      .is("deleted_at", null)
      .single(),
    supabase
      .from("proposal_sites")
      .select("*, site:sites(id, site_code, name, media_type, status, city, state, address, width_ft, height_ft, total_sqft, base_rate_paise, illumination, facing, visibility_distance_m)")
      .eq("proposal_id", id)
      .order("display_order"),
    supabase
      .from("organizations")
      .select("name, address, city, state, pin_code, gstin, phone, email, logo_url")
      .eq("id", profile.org_id)
      .single(),
  ]);

  if (!proposalData) notFound();

  const proposal = proposalData as unknown as Proposal & { client?: { id: string; company_name: string } | null };
  const proposalSites = (proposalSitesData ?? []) as unknown as (ProposalSite & { site: Site })[];
  const org = orgData as (Pick<Organization, "name" | "address" | "city" | "state" | "pin_code" | "gstin" | "phone" | "email"> & { logo_url?: string | null }) | null;

  // Fetch primary photos for proposal sites. The `site-photos` bucket is
  // private, so we sign each path before passing it to the PDF renderer /
  // preview. Without signed URLs, ProposalDocument's <Image> components
  // would 403 and the render would crash.
  const siteIds = proposalSites.map((ps) => ps.site_id);
  let photoMap: Record<string, string> = {};
  if (siteIds.length > 0) {
    const { data: photos } = await supabase
      .from("site_photos")
      .select("site_id, photo_url")
      .in("site_id", siteIds)
      .eq("is_primary", true);
    const rawPaths = (photos ?? [])
      .map((p) => p.photo_url)
      .filter((u): u is string => !!u && !/^https?:\/\//i.test(u));
    const signed = await getSignedUrls("site-photos", rawPaths);
    photoMap = (photos ?? []).reduce<Record<string, string>>((acc, p) => {
      const isUrl = /^https?:\/\//i.test(p.photo_url);
      const resolved = isUrl ? p.photo_url : signed[p.photo_url];
      if (resolved) acc[p.site_id] = resolved;
      return acc;
    }, {});
  }

  const sitesForExport: SiteForProposal[] = proposalSites.map((ps) => ({
    id: ps.site.id,
    site_code: ps.site.site_code,
    name: ps.site.name,
    media_type: ps.site.media_type,
    status: ps.site.status,
    city: ps.site.city,
    state: ps.site.state,
    address: ps.site.address,
    width_ft: ps.site.width_ft,
    height_ft: ps.site.height_ft,
    total_sqft: ps.site.total_sqft,
    base_rate_paise: ps.custom_rate_paise ?? ps.site.base_rate_paise,
    illumination: ps.site.illumination,
    facing: ps.site.facing,
    visibility_distance_m: ps.site.visibility_distance_m,
    primary_photo_url: photoMap[ps.site_id] ?? null,
  }));

  const statusToneClass = STATUS_TONE[proposal.status] ?? STATUS_TONE.draft;

  return (
    <div className="max-w-6xl">
      {/* Breadcrumb + actions */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/proposals"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Proposals
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {proposal.proposal_name}
            </h1>
            <Badge
              variant="outline"
              className={`gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide ${statusToneClass}`}
            >
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
              {proposal.status.charAt(0).toUpperCase() + proposal.status.slice(1)}
            </Badge>
          </div>
          {proposal.client && (
            <p className="mt-1 text-sm text-muted-foreground">
              Client:{" "}
              <Link
                href={`/clients/${proposal.client.id}`}
                className="text-primary hover:underline"
              >
                {proposal.client.company_name}
              </Link>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ProposalExportButtons
            proposal={proposal}
            sites={sitesForExport}
            org={org}
          />
          <Link href={`/proposals/${id}/edit`}>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Edit className="h-4 w-4" />
              Edit
            </Button>
          </Link>
          <ProposalActions proposalId={id} proposalName={proposal.proposal_name} />
        </div>
      </div>

      {/* Summary tiles */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "Layout", value: proposal.template_type?.replace(/_/g, " ") },
          { label: "Rate Display", value: proposal.show_rates?.replace(/_/g, " ") },
          { label: "Sites", value: proposalSites.length },
          { label: "Created", value: format(new Date(proposal.created_at), "dd MMM yyyy") },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-2xl border border-border bg-card card-elevated p-4"
          >
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {item.label}
            </p>
            <p className="mt-1 text-sm font-medium capitalize text-foreground tabular-nums">
              {item.value}
            </p>
          </div>
        ))}
      </div>

      {/* Sites List */}
      <section className="mb-6 rounded-2xl border border-border bg-card card-elevated p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            Included Sites ({proposalSites.length})
          </h2>
        </div>
        {proposalSites.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            No sites in this proposal.
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  {["#", "Site", "Location", "Dimensions", "Type", "Rate"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {proposalSites.map((ps, i) => (
                  <tr key={ps.id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/sites/${ps.site.id}`}
                        className="font-medium text-foreground hover:text-primary hover:underline"
                      >
                        {ps.site.name}
                      </Link>
                      <p className="text-xs font-mono text-muted-foreground">
                        {ps.site.site_code}
                      </p>
                      {ps.custom_notes && (
                        <p className="mt-0.5 text-xs italic text-muted-foreground">
                          {ps.custom_notes}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {ps.site.city}, {ps.site.state}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">
                      {ps.site.width_ft && ps.site.height_ft
                        ? `${ps.site.width_ft}×${ps.site.height_ft} ft`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 capitalize text-muted-foreground">
                      {ps.site.media_type?.replace(/_/g, " ")}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground tabular-nums">
                      {displayRate(ps.custom_rate_paise ?? ps.site.base_rate_paise, proposal.show_rates)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Notes */}
      {proposal.notes && (
        <section className="rounded-2xl border border-border bg-card card-elevated p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Notes</h2>
          </div>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {proposal.notes}
          </p>
        </section>
      )}
    </div>
  );
}
