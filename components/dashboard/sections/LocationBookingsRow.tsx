// Top sites by booking value — which hoardings are earning their keep in this
// range. The top three get their real site photo; the rest are a compact list.
// Pairs with CityBookingsRow, which rolls the same figures up by city.
//
// Only three photos are loaded, and lazily: site photos are 200–300 KB each
// and most of the team opens this on a phone.
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { ArrowUpRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SiteCode } from "@/components/dashboard/SiteCode";
import { SiteGlyph } from "@/components/dashboard/SiteGlyph";
import { MediaGlyph } from "@/components/shared/MediaGlyph";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { createClient } from "@/lib/supabase/server";
import { getSignedUrls } from "@/lib/supabase/signed-urls";
import { inr } from "@/lib/utils";
import { prorateByRange, daysInRange } from "@/lib/utils/date-ranges";

const MAX_ROWS = 15;
const PODIUM = 3;

export async function LocationBookingsRow({
  orgId,
  from,
  to,
}: {
  orgId: string;
  from: string;
  to: string;
}) {
  const supabase = await createClient();
  const t = await getTranslations("dashboard");

  const [{ data: campaignSites }, { data: sites }] = await Promise.all([
    supabase
      .from("campaign_sites")
      .select(
        `
        campaign_id,
        site_id,
        display_rate_paise,
        rate_type,
        start_date,
        end_date,
        campaign:campaigns(start_date, end_date, status, deleted_at, pricing_type, total_value_paise)
      `,
      )
      .eq("organization_id", orgId),
    supabase
      .from("sites")
      .select("id, name, site_code, city, media_type, status")
      .eq("organization_id", orgId)
      .is("deleted_at", null),
  ]);

  type CampaignSiteRow = {
    campaign_id: string;
    site_id: string;
    display_rate_paise: number | null;
    rate_type: "per_month" | "fixed" | null;
    start_date: string | null;
    end_date: string | null;
    campaign: {
      start_date: string | null;
      end_date: string | null;
      status: string | null;
      deleted_at: string | null;
      pricing_type: "itemized" | "bundled" | null;
      total_value_paise: number | null;
    } | null;
  };

  type Site = {
    id: string;
    name: string;
    site_code: string | null;
    city: string | null;
    media_type: string | null;
    status: string | null;
  };

  // Group by campaign so we can equal-split bundled campaign totals
  // across the campaign's sites — same logic as CityBookingsRow.
  const filteredRows = ((campaignSites ?? []) as unknown as CampaignSiteRow[]).filter(
    (r) => {
      const c = r.campaign;
      return !!c && !c.deleted_at && c.status !== "cancelled";
    },
  );
  const byCampaign = new Map<string, CampaignSiteRow[]>();
  for (const r of filteredRows) {
    const arr = byCampaign.get(r.campaign_id) ?? [];
    arr.push(r);
    byCampaign.set(r.campaign_id, arr);
  }

  const perSiteValue = new Map<string, number>();
  const perSiteCampaigns = new Map<string, number>();
  for (const siteRows of byCampaign.values()) {
    const sample = siteRows[0]?.campaign;
    if (!sample) continue;
    const isBundled = sample.pricing_type === "bundled";
    const bundledPerSite = isBundled && siteRows.length > 0
      ? Math.floor((sample.total_value_paise ?? 0) / siteRows.length)
      : 0;

    for (const row of siteRows) {
      const bookingFrom = row.start_date ?? sample.start_date;
      const bookingTo = row.end_date ?? sample.end_date;
      if (!bookingFrom || !bookingTo) continue;

      // Same pro-rata rules as the campaign-total trigger (migration 042):
      let share = 0;
      if (isBundled) {
        share = prorateByRange(bookingFrom, bookingTo, bundledPerSite, from, to);
      } else if (row.rate_type === "per_month") {
        const overlapStart = bookingFrom > from ? bookingFrom : from;
        const overlapEnd = bookingTo < to ? bookingTo : to;
        if (overlapEnd >= overlapStart) {
          const overlapDays = daysInRange(overlapStart, overlapEnd);
          share = Math.round(
            ((row.display_rate_paise ?? 0) * overlapDays) / 30,
          );
        }
      } else {
        share = prorateByRange(
          bookingFrom,
          bookingTo,
          row.display_rate_paise ?? 0,
          from,
          to,
        );
      }
      if (share <= 0) continue;

      perSiteValue.set(
        row.site_id,
        (perSiteValue.get(row.site_id) ?? 0) + share,
      );
      perSiteCampaigns.set(
        row.site_id,
        (perSiteCampaigns.get(row.site_id) ?? 0) + 1,
      );
    }
  }

  const rows = ((sites ?? []) as Site[])
    .map((s) => ({
      ...s,
      value: perSiteValue.get(s.id) ?? 0,
      campaigns: perSiteCampaigns.get(s.id) ?? 0,
    }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_ROWS);

  const podium = rows.slice(0, PODIUM);
  const others = rows.slice(PODIUM);
  const best = rows[0]?.value ?? 0;
  const photos = await podiumPhotos(podium.map((s) => s.id));

  return (
    <Card className="rounded-3xl">
      <CardHeader className="flex flex-row items-end justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="text-xl">{t("top_booked_title")}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {t("top_booked_sub")}
          </p>
        </div>
        {rows.length > 0 && (
          <Link href="/sites" className="btn-pill-ghost">
            {t("all_sites")}
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("no_site_bookings")}
          </p>
        ) : (
          <>
            <ol className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {podium.map((s, i) => (
                <li key={s.id}>
                  <Link
                    href={`/sites/${s.id}`}
                    className="dark group relative isolate flex aspect-[4/3] flex-col justify-between overflow-hidden rounded-2xl bg-[#10150e] p-4 text-foreground sm:aspect-[5/4] lg:aspect-[16/11]"
                  >
                    {photos[s.id] ? (
                      <Image
                        src={photos[s.id]}
                        alt={t("photo_of", { name: s.name })}
                        fill
                        unoptimized
                        sizes="(min-width: 40rem) 33vw, 100vw"
                        className="-z-10 object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                      />
                    ) : (
                      <span className="hatch absolute inset-0 -z-10 flex items-center justify-center">
                        <MediaGlyph
                          type={s.media_type}
                          className="size-16 text-white/35"
                        />
                      </span>
                    )}
                    <span
                      aria-hidden
                      className="absolute inset-0 -z-10 bg-gradient-to-t from-black/90 from-8% via-black/30 via-50% to-transparent"
                    />
                    <span className="flex items-start justify-between">
                      <span className="figure flex size-9 items-center justify-center rounded-full bg-volt text-base text-ink">
                        {i + 1}
                      </span>
                      <StatusBadge status={s.status ?? "—"} onPhoto />
                    </span>
                    <span>
                      <span className="flex items-center gap-2">
                        <SiteCode
                          code={s.site_code}
                          className="bg-white/15 text-white/85"
                        />
                        <span className="truncate text-xs text-white/75">
                          {s.city ?? "—"}
                          {!photos[s.id] && ` · ${t("no_photo")}`}
                        </span>
                      </span>
                      <span className="mt-1.5 block truncate text-sm font-medium text-white">
                        {s.name}
                      </span>
                      <span className="figure mt-2 block text-2xl text-white">
                        {inr(s.value)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>

            {others.length > 0 && (
              <ol
                start={PODIUM + 1}
                className="mt-4 grid grid-cols-1 gap-x-8 lg:grid-cols-2"
              >
                {others.map((s) => (
                  <li
                    key={s.id}
                    className="border-b border-border/70 last:border-0 lg:[&:nth-last-child(2):nth-child(odd)]:border-0"
                  >
                    <Link
                      href={`/sites/${s.id}`}
                      className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted/60"
                    >
                      <SiteGlyph
                        type={s.media_type}
                        lit={s.status === "booked"}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {s.name}
                          </span>
                          <SiteCode code={s.site_code} />
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {s.city ?? "—"}
                          {" · "}
                          <span className="capitalize">
                            {s.media_type?.replace(/_/g, " ") ?? "—"}
                          </span>
                          {" · "}
                          {t("campaigns_count", { count: s.campaigns })}
                        </span>
                      </span>
                      <StatusBadge
                        status={s.status ?? "—"}
                        className="hidden xl:inline-flex"
                      />
                      <span className="w-24 shrink-0 text-right">
                        <span className="block text-sm font-semibold tabular-nums">
                          {inr(s.value)}
                        </span>
                        <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full bg-chart-1"
                            style={{ width: `${(s.value / best) * 100}%` }}
                          />
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Signed URL of the best photo for each site: primary first, then order. */
async function podiumPhotos(siteIds: string[]): Promise<Record<string, string>> {
  if (siteIds.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("site_photos")
    .select("site_id, photo_url, is_primary, sort_order")
    .in("site_id", siteIds)
    .order("is_primary", { ascending: false })
    .order("sort_order");

  const pathBySite: Record<string, string> = {};
  for (const row of data ?? []) {
    if (!pathBySite[row.site_id]) pathBySite[row.site_id] = row.photo_url;
  }
  const signed = await getSignedUrls("site-photos", Object.values(pathBySite));
  return Object.fromEntries(
    Object.entries(pathBySite)
      .filter(([, path]) => signed[path])
      .map(([siteId, path]) => [siteId, signed[path]]),
  );
}
