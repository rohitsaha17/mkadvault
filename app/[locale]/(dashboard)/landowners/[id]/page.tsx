import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";
import { inr, fmt } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft, Phone, Mail, MapPin,
  Lock, FileText, Building2, Pencil, User, MapPinned,
} from "lucide-react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { Landowner, Contract, Site, ContractPayment } from "@/lib/types/database";

// Roles that can see bank/PAN details
const SENSITIVE_ROLES = ["super_admin", "admin", "accounts"];

export default async function LandownerDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();

  // Fetch landowner + cached session (for role gating) in parallel
  const [{ data: lData }, session] = await Promise.all([
    supabase.from("landowners").select("*").eq("id", id).is("deleted_at", null).single(),
    getSession(),
  ]);

  if (!lData) notFound();
  const landowner = lData as unknown as Landowner;

  // Role-gate sensitive fields using the cached profile from the session helper
  const canViewSensitive = SENSITIVE_ROLES.includes(session?.profile?.role ?? "");

  // Fetch linked contracts
  const { data: contractsData } = await supabase
    .from("contracts")
    .select("*")
    .eq("landowner_id", id)
    .is("deleted_at", null)
    .order("start_date", { ascending: false })
    .limit(50);
  const contracts = (contractsData ?? []) as unknown as Contract[];

  // Fetch site details for linked contracts
  const siteIds = [...new Set(contracts.map((c) => c.site_id))];
  let sites: Site[] = [];
  if (siteIds.length > 0) {
    const { data: sitesData } = await supabase
      .from("sites").select("id, name, site_code, city").in("id", siteIds);
    sites = (sitesData ?? []) as unknown as Site[];
  }
  const siteMap = new Map(sites.map((s) => [s.id, s]));

  // Fetch recent payments across all landowner contracts
  const contractIds = contracts.map((c) => c.id);
  let payments: ContractPayment[] = [];
  if (contractIds.length > 0) {
    const { data: paymentsData } = await supabase
      .from("contract_payments")
      .select("*")
      .in("contract_id", contractIds)
      .order("due_date", { ascending: false })
      .limit(20);
    payments = (paymentsData ?? []) as unknown as ContractPayment[];
  }

  // Fetch sites directly owned by this landowner (via sites.landowner_id)
  const { data: ownedSitesData } = await supabase
    .from("sites")
    .select("id, site_code, name, city, media_type, status")
    .eq("landowner_id", id)
    .is("deleted_at", null)
    .order("city")
    .order("name")
    .limit(50);
  const ownedSites = (ownedSitesData ?? []) as Array<{
    id: string; site_code: string; name: string; city: string; media_type: string; status: string;
  }>;

  const activeContracts = contracts.filter((c) => c.status === "active");

  return (
    <div className="max-w-5xl">
      {/* Breadcrumb + actions */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/landowners"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Landowners
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {landowner.full_name}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Added {fmt(landowner.created_at)} · {activeContracts.length} active contract{activeContracts.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/landowners/${id}/edit`}>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: Details */}
        <div className="space-y-6 lg:col-span-2">

          {/* Personal info */}
          <Section title="Contact Information" icon={<User className="h-4 w-4" />}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <DetailItem
                label="Primary Phone"
                value={landowner.phone}
                icon={<Phone className="h-3.5 w-3.5 text-muted-foreground" />}
              />
              <DetailItem label="Alternate Phone" value={landowner.phone_alt} />
              <DetailItem
                label="Email"
                value={landowner.email}
                icon={<Mail className="h-3.5 w-3.5 text-muted-foreground" />}
                colSpan
              />
            </dl>
          </Section>

          {/* Address */}
          <Section title="Address" icon={<MapPin className="h-4 w-4" />}>
            <div className="space-y-0.5 text-sm text-foreground">
              {landowner.address && <p>{landowner.address}</p>}
              {(landowner.city || landowner.state || landowner.pin_code) && (
                <p>
                  {[landowner.city, landowner.state, landowner.pin_code]
                    .filter(Boolean).join(", ")}
                </p>
              )}
              {!landowner.address && !landowner.city && !landowner.state && (
                <p className="text-muted-foreground">No address on record</p>
              )}
            </div>
          </Section>

          {/* Bank details — role gated */}
          <Section
            title="Bank & Tax Details"
            icon={<Lock className="h-4 w-4" />}
            headerExtra={
              !canViewSensitive ? (
                <Badge variant="outline" className="ml-auto text-xs">
                  Restricted
                </Badge>
              ) : null
            }
          >
            {canViewSensitive ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <DetailItem label="PAN Number" value={landowner.pan_number} mono />
                <DetailItem label="Aadhaar Reference" value={landowner.aadhaar_reference} />
                <DetailItem label="Bank Name" value={landowner.bank_name} />
                <DetailItem label="Account Number" value={landowner.bank_account_number} mono />
                <DetailItem label="IFSC Code" value={landowner.bank_ifsc} mono />
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                Bank and tax details are visible to Admin and Accounts roles only.
              </p>
            )}
          </Section>

          {/* Notes */}
          {landowner.notes && (
            <Section title="Notes" icon={<FileText className="h-4 w-4" />}>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {landowner.notes}
              </p>
            </Section>
          )}

          {/* Owned Sites */}
          <Section title="Owned Sites" icon={<MapPinned className="h-4 w-4" />}>
            {ownedSites.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                This landowner doesn't own any sites yet. Link sites from the site form (Commercial step).
              </p>
            ) : (
              <div className="divide-y divide-border -mx-1">
                {ownedSites.map((s) => (
                  <Link
                    key={s.id}
                    href={`/sites/${s.id}`}
                    className="flex items-center justify-between gap-3 px-1 py-3 rounded-lg hover:bg-muted/40 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {s.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-mono">{s.site_code}</span> · {s.city} · {s.media_type.replace(/_/g, " ")}
                      </p>
                    </div>
                    <StatusBadge status={s.status} />
                  </Link>
                ))}
              </div>
            )}
          </Section>

          {/* Payment history */}
          {payments.length > 0 && (
            <Section title="Recent Payments" icon={<FileText className="h-4 w-4" />}>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Due Date</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Amount Due</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Paid</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {payments.map((p) => (
                      <tr key={p.id} className="hover:bg-muted">
                        <td className="px-4 py-2.5 tabular-nums text-foreground">{fmt(p.due_date)}</td>
                        <td className="px-4 py-2.5 tabular-nums text-foreground">{inr(p.amount_due_paise)}</td>
                        <td className="px-4 py-2.5 tabular-nums text-foreground">
                          {p.amount_paid_paise ? inr(p.amount_paid_paise) : "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge variant="outline" className="text-xs capitalize">
                            {p.status.replace(/_/g, " ")}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
        </div>

        {/* Right: Contracts */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card card-elevated p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Linked Contracts</h3>
              <Link href={`/contracts/new?landowner_id=${id}`}>
                <Button size="sm" variant="outline">+ New</Button>
              </Link>
            </div>

            {contracts.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No contracts yet
              </p>
            ) : (
              <div className="space-y-3">
                {contracts.map((c) => {
                  const site = siteMap.get(c.site_id);
                  return (
                    <Link
                      key={c.id}
                      href={`/contracts/${c.id}`}
                      className="block rounded-lg border border-border p-3 transition-colors hover:bg-muted"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Building2 className="h-3 w-3 shrink-0" />
                            <span className="truncate text-foreground">{site?.name ?? c.site_id}</span>
                            {site?.site_code && (
                              <span className="font-mono text-muted-foreground">{site.site_code}</span>
                            )}
                          </div>
                          <p className="text-xs tabular-nums text-muted-foreground">
                            {fmt(c.start_date)} → {c.end_date ? fmt(c.end_date) : "Open-ended"}
                          </p>
                          {c.rent_amount_paise && (
                            <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                              {inr(c.rent_amount_paise)}
                              <span className="ml-1 text-xs font-normal text-muted-foreground">/ mo</span>
                            </p>
                          )}
                        </div>
                        <Badge
                          variant="outline"
                          className="shrink-0 text-xs capitalize"
                        >
                          {c.status.replace(/_/g, " ")}
                        </Badge>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helper components ────────────────────────────────────────────────────────

function Section({
  title,
  icon,
  headerExtra,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card card-elevated p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
        <span className="text-muted-foreground">{icon}</span>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {headerExtra}
      </div>
      {children}
    </section>
  );
}

function DetailItem({
  label,
  value,
  icon,
  mono,
  colSpan,
}: {
  label: string;
  value: string | number | null | undefined;
  icon?: React.ReactNode;
  mono?: boolean;
  colSpan?: boolean;
}) {
  return (
    <div className={colSpan ? "col-span-2" : ""}>
      <dt className="mb-0.5 text-xs text-muted-foreground">{label}</dt>
      <dd className={`flex items-center gap-1.5 text-foreground ${mono ? "font-mono" : ""}`}>
        {value ? (
          <>
            {icon}
            {value}
          </>
        ) : (
          "—"
        )}
      </dd>
    </div>
  );
}
