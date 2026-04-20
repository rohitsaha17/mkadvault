"use client";
// SiteSelectFilter — small client component for the calendar page's site filter.
// Pushes a new URL when the selection changes so the server re-fetches.
import { useRouter, usePathname } from "next/navigation";

interface Props {
  sites: { id: string; name: string; site_code: string }[];
  currentSite: string;
  year: number;
  month: number;
}

export function SiteSelectFilter({ sites, currentSite, year, month }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  function onChange(siteId: string) {
    const params = new URLSearchParams({
      year: String(year),
      month: String(month),
    });
    if (siteId) params.set("site", siteId);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <select
      value={currentSite}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <option value="">All Sites</option>
      {sites.map((s) => (
        <option key={s.id} value={s.id}>
          {s.site_code} — {s.name}
        </option>
      ))}
    </select>
  );
}
