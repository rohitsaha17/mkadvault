// Site Inventory Report — full list of all active sites with key specs.
// Server component. Fetches all non-deleted sites and renders a table.
// A client component (SiteInventoryExport) handles CSV download.

import { setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";
import { inr } from "@/lib/utils";
import {
  SiteInventoryExport,
  type SiteInventoryRow,
} from "@/components/reports/SiteInventoryExport";

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function SiteInventoryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();

  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);

  const { profile } = session;

  if (!profile?.org_id) {
    return (
      <div className="p-6 text-center text-muted-foreground text-sm">
        Your account is not linked to an organisation yet.
      </div>
    );
  }

  const orgId: string = profile.org_id;

  // Fetch all non-deleted sites, ordered by city then site code
  const { data: sitesData, error } = await supabase
    .from("sites")
    .select(
      "id, name, site_code, city, state, media_type, width_ft, height_ft, total_sqft, status, ownership_model, base_rate_paise, illumination"
    )
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .order("city")
    .order("site_code");

  if (error) {
    return (
      <div className="p-6 text-red-500 text-sm">
        Failed to load sites: {error.message}
      </div>
    );
  }

  // Cast to our strongly-typed interface
  const sites: SiteInventoryRow[] = (sitesData ?? []).map((row) => ({
    id: row.id as string,
    site_code: row.site_code as string,
    name: row.name as string,
    city: row.city as string,
    state: row.state as string,
    media_type: row.media_type as string,
    width_ft: row.width_ft as number | null,
    height_ft: row.height_ft as number | null,
    total_sqft: row.total_sqft as number | null,
    status: row.status as string,
    ownership_model: row.ownership_model as string,
    base_rate_paise: row.base_rate_paise as number | null,
    illumination: row.illumination as string | null,
  }));

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Site Inventory</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {sites.length} site{sites.length !== 1 ? "s" : ""} — dimensions, rates and status
          </p>
        </div>
        <SiteInventoryExport data={sites} />
      </div>

      {/* Table */}
      {sites.length === 0 ? (
        <p className="text-center text-muted-foreground text-sm py-12">No sites found.</p>
      ) : (
        <div className="rounded-xl border bg-white shadow-sm overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted">
                <TableHead>Site Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Media Type</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Illumination</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ownership</TableHead>
                <TableHead>Base Rate / mo</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sites.map((site) => (
                <TableRow key={site.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {site.site_code}
                  </TableCell>
                  <TableCell className="font-medium text-foreground">
                    {site.name}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{site.city}</TableCell>
                  <TableCell>
                    <span className="capitalize text-muted-foreground">
                      {site.media_type.replace(/_/g, " ")}
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground whitespace-nowrap">
                    {site.width_ft != null && site.height_ft != null
                      ? `${site.width_ft} × ${site.height_ft} ft`
                      : site.total_sqft != null
                      ? `${site.total_sqft} sqft`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground capitalize">
                    {site.illumination ?? "—"}
                  </TableCell>
                  <TableCell>
                    <SiteStatusBadge status={site.status} />
                  </TableCell>
                  <TableCell className="capitalize text-muted-foreground">
                    {site.ownership_model}
                  </TableCell>
                  <TableCell className="tabular-nums text-foreground">
                    {site.base_rate_paise != null ? inr(site.base_rate_paise) : "—"}
                  </TableCell>
                  <TableCell>
                    <Link href={`/${locale}/sites/${site.id}`}>
                      <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function SiteStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    available: "bg-emerald-100 text-emerald-700",
    booked: "bg-blue-100 text-blue-700",
    maintenance: "bg-amber-100 text-amber-700",
    blocked: "bg-muted text-muted-foreground",
    expired: "bg-red-100 text-red-700",
  };
  const cls = map[status] ?? "bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={`text-xs font-normal border-0 ${cls}`}>
      {status}
    </Badge>
  );
}
