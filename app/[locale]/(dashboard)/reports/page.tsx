// Reports hub — shows all available report cards plus quick stats.
// Server component: fetches summary counts from Supabase to show
// at-a-glance figures on each card.

import { setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Users,
  Home,
  Building2,
  Receipt,
  FileText,
  MapPin,
  Megaphone,
  BarChart3,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";

// ─── Report card definition ──────────────────────────────────────────────────

interface ReportCard {
  title: string;
  description: string;
  href: string;
  // Icon is a Lucide icon component — typed as a React element factory
  Icon: React.ComponentType<{ className?: string }>;
  stat: string | null; // quick stat shown below the description
  statLabel: string | null;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function ReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();

  // Auth check (cached per request)
  const session = await getSession();

  if (!session) {
    redirect(`/${locale}/login`);
  }

  const { profile } = session;

  if (!profile?.org_id) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        Your account is not linked to an organisation yet. Contact your administrator.
      </div>
    );
  }

  const orgId: string = profile.org_id;

  // Financial year bounds: Apr 1 this-or-last year → Mar 31 next year
  // If current month >= April we are in the FY starting this year, else last year.
  const now = new Date();
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyStart = `${fyStartYear}-04-01`;
  const fyEnd = `${fyStartYear + 1}-03-31`;

  // Run all four count queries in parallel for speed
  const [clientsRes, landownersRes, invoicesRes, sitesRes] = await Promise.all([
    supabase
      .from("clients")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("deleted_at", null),

    supabase
      .from("landowners")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("deleted_at", null),

    supabase
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .gte("invoice_date", fyStart)
      .lte("invoice_date", fyEnd),

    supabase
      .from("sites")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("deleted_at", null),
  ]);

  const clientCount = clientsRes.count ?? 0;
  const landownerCount = landownersRes.count ?? 0;
  const invoiceCount = invoicesRes.count ?? 0;
  const siteCount = sitesRes.count ?? 0;

  // ─── Report card definitions ───────────────────────────────────────────────
  // Locale-prefixed paths so next-intl routing works correctly.

  const base = `/${locale}/reports`;

  const reports: ReportCard[] = [
    {
      title: "Client Revenue",
      description: "Revenue, billings and outstanding by client",
      href: `${base}/client-revenue`,
      Icon: Users,
      stat: String(clientCount),
      statLabel: "active clients",
    },
    {
      title: "Landowner Payments",
      description: "Rent paid, TDS deducted by landowner",
      href: `${base}/landowner-payments`,
      Icon: Home,
      stat: String(landownerCount),
      statLabel: "landowners",
    },
    {
      title: "Agency Trading",
      description: "Revenue and margins from agency sites",
      href: `${base}/agency-trading`,
      Icon: Building2,
      stat: null,
      statLabel: null,
    },
    {
      title: "GST Summary",
      description: "Monthly CGST / SGST / IGST breakdown for GST returns",
      href: `${base}/gst-summary`,
      Icon: Receipt,
      stat: String(invoiceCount),
      statLabel: `invoices this FY`,
    },
    {
      title: "TDS Summary",
      description: "TDS deducted quarterly by landowner",
      href: `${base}/tds-summary`,
      Icon: FileText,
      stat: null,
      statLabel: null,
    },
    {
      title: "Site Inventory",
      description: "Full site list with dimensions and rates",
      href: `${base}/site-inventory`,
      Icon: MapPin,
      stat: String(siteCount),
      statLabel: "sites",
    },
    {
      title: "Campaign Performance",
      description: "Campaign revenue and duration analysis",
      href: `${base}/campaign-performance`,
      Icon: Megaphone,
      stat: null,
      statLabel: null,
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Insights"
        title="Reports"
        description="Analytics and exports for your OOH operations."
        actions={
          <Link href={`${base}/site-pnl`}>
            <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
              <BarChart3 className="h-4 w-4" />
              Site P&amp;L
            </Button>
          </Link>
        }
      />

      {/* Report grid — 1 col on mobile, 2 on sm, 3 on lg */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((report) => (
          <ReportCardItem key={report.href} report={report} />
        ))}
      </div>
    </div>
  );
}

// ─── Report card sub-component ────────────────────────────────────────────────
// Kept in this file since it's only used here and is small.

function ReportCardItem({ report }: { report: ReportCard }) {
  const { Icon } = report;

  return (
    <Card className="group transition-shadow hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          {/* Icon in a brand-tinted tile */}
          <div className="flex-shrink-0 rounded-xl bg-gradient-to-br from-indigo-500/10 to-violet-500/10 p-2.5 ring-1 ring-inset ring-border/60">
            <Icon className="h-5 w-5 text-primary" />
          </div>

          <div className="min-w-0">
            <CardTitle className="text-sm font-semibold leading-tight text-foreground">
              {report.title}
            </CardTitle>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              {report.description}
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {report.stat != null && (
          <p className="mb-3 text-xs text-muted-foreground">
            <span className="font-semibold tabular-nums text-foreground">{report.stat}</span>{" "}
            {report.statLabel}
          </p>
        )}

        <Link href={report.href}>
          <Button variant="secondary" size="sm" className="w-full gap-1.5 text-xs">
            View Report
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
