// Site Availability Calendar — shows a month-grid for each site's status.
// When campaigns are added in Sprint 4, booked periods will show as coloured bars.
// For now it renders the current month with site status indicators.
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  LayoutList,
  MapPin,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { CalendarGrid } from "@/components/sites/CalendarGrid";

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ site?: string; month?: string; year?: string }>;
}

export default async function SiteCalendarPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const sp = await searchParams;
  const siteFilter = sp.site ?? "";

  // Parse month/year from URL, default to current month
  const now = new Date();
  const year = parseInt(sp.year ?? String(now.getFullYear()), 10);
  const month = parseInt(sp.month ?? String(now.getMonth() + 1), 10); // 1-based

  const supabase = await createClient();

  // Fetch all sites (for the filter dropdown)
  const { data: sites } = await supabase
    .from("sites")
    .select("id, site_code, name, status, city")
    .is("deleted_at", null)
    .order("city")
    .order("name")
    .limit(200);

  // Sites to show (filtered or all)
  const displayedSites = siteFilter
    ? (sites ?? []).filter((s) => s.id === siteFilter)
    : (sites ?? []).slice(0, 20); // cap at 20 for performance

  // Build prev/next month links
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  const monthLabel = new Date(year, month - 1, 1).toLocaleString("en-IN", {
    month: "long",
    year: "numeric",
  });

  const buildNavUrl = (y: number, m: number, site?: string) => {
    const params = new URLSearchParams({ year: String(y), month: String(m) });
    if (site) params.set("site", site);
    return `/sites/calendar?${params.toString()}`;
  };

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Availability Calendar</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            See when each site is booked, available, or under maintenance
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/sites">
            <Button variant="outline" size="sm" className="gap-1.5">
              <LayoutList className="h-4 w-4" />
              <span className="hidden sm:inline">List</span>
            </Button>
          </Link>
          <Link href="/sites/map">
            <Button variant="outline" size="sm" className="gap-1.5">
              <MapPin className="h-4 w-4" />
              <span className="hidden sm:inline">Map</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        {/* Month navigator */}
        <div className="flex items-center gap-2">
          <Link href={buildNavUrl(prevYear, prevMonth, siteFilter || undefined)}>
            <Button variant="outline" size="sm" className="h-8 w-8 p-0">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </Link>
          <span className="text-sm font-semibold text-foreground min-w-[140px] text-center">
            {monthLabel}
          </span>
          <Link href={buildNavUrl(nextYear, nextMonth, siteFilter || undefined)}>
            <Button variant="outline" size="sm" className="h-8 w-8 p-0">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </Link>
          {(year !== now.getFullYear() || month !== now.getMonth() + 1) && (
            <Link href={buildNavUrl(now.getFullYear(), now.getMonth() + 1, siteFilter || undefined)}>
              <Button variant="ghost" size="sm" className="h-8 text-xs">
                Today
              </Button>
            </Link>
          )}
        </div>

        {/* Site filter */}
        <SiteSelectFilter
          sites={(sites ?? []).map((s) => ({ id: s.id, name: s.name, site_code: s.site_code }))}
          currentSite={siteFilter}
          year={year}
          month={month}
        />

        {/* Legend */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground ml-auto flex-wrap">
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-6 rounded-sm bg-emerald-400 inline-block" />
            Available
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-6 rounded-sm bg-blue-400 inline-block" />
            Booked
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-6 rounded-sm bg-amber-400 inline-block" />
            Maintenance
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-6 rounded-sm bg-muted-foreground/40 inline-block" />
            Blocked
          </span>
        </div>
      </div>

      {/* Calendar grid */}
      {displayedSites.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-foreground font-medium">No sites to display</p>
          <p className="text-sm text-muted-foreground mt-1">
            <Link href="/sites/new" className="text-blue-600 hover:underline">
              Add a site
            </Link>{" "}
            to see it on the calendar.
          </p>
        </div>
      ) : (
        <CalendarGrid
          sites={displayedSites as { id: string; site_code: string; name: string; status: string; city?: string | null }[]}
          year={year}
          month={month}
          // bookings will be passed here from campaigns in Sprint 4
          bookings={[]}
        />
      )}

      {!siteFilter && (sites?.length ?? 0) > 20 && (
        <p className="mt-3 text-xs text-muted-foreground text-center">
          Showing first 20 sites. Use the site filter to see a specific site.
        </p>
      )}
    </div>
  );
}

// ─── Client component for site filter select ─────────────────────────────────
// Must be a separate client component because it uses useRouter for navigation.

import { SiteSelectFilter } from "@/components/sites/SiteSelectFilter";
