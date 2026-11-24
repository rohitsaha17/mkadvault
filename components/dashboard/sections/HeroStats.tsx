// Hero stats — the frosted strip along the bottom of the dashboard hero: what
// is selling in this period. Four cells, each linking to campaigns:
//
//   1. Booked     — pro-rata of every campaign's value by the days that fall
//                   inside the range, so a 3-month campaign spanning the
//                   boundary contributes only its share.
//   2. Live now   — value on hoardings today (not range-dependent).
//   3. Starting   — campaigns whose start_date falls in the range.
//   4. Ending     — campaigns whose end_date falls in the range, and how many
//                   of those are still running.
//
// Every number pro-rates via prorateByRange() so a campaign that straddles
// two periods is counted in each by its actual days-in-period.
import { getTranslations } from "next-intl/server";
import {
  CalendarPlus,
  CalendarX2,
  IndianRupee,
  RadioTower,
  type LucideIcon,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { inr } from "@/lib/utils";
import { prorateByRange, daysInRange } from "@/lib/utils/date-ranges";

export async function HeroStats({
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

  const todayStr = new Date().toISOString().slice(0, 10);

  // Pull every campaign that could overlap the range, plus each one's
  // sites (for rate_type / display_rate) and services (for lump-sum
  // amounts). We pro-rate each component independently with the same
  // formula migration 042's trigger uses for campaigns.total_value_paise.
  const [{ data: campaigns }, { data: liveToday }] = await Promise.all([
    supabase
      .from("campaigns")
      .select(
        `
        id,
        total_value_paise,
        start_date,
        end_date,
        status,
        created_at,
        pricing_type,
        campaign_sites(display_rate_paise, rate_type, start_date, end_date),
        campaign_services(total_paise)
      `,
      )
      .eq("organization_id", orgId)
      .not("status", "in", "(cancelled)")
      .is("deleted_at", null)
      .not("start_date", "is", null)
      .not("end_date", "is", null)
      .lte("start_date", to)
      .gte("end_date", from),
    supabase
      .from("campaigns")
      .select("total_value_paise")
      .eq("organization_id", orgId)
      .eq("status", "live")
      .is("deleted_at", null),
  ]);

  type CampaignRow = {
    id: string;
    total_value_paise: number | null;
    start_date: string | null;
    end_date: string | null;
    status: string;
    created_at: string | null;
    pricing_type: "itemized" | "bundled" | null;
    campaign_sites: Array<{
      display_rate_paise: number | null;
      rate_type: "per_month" | "fixed" | null;
      start_date: string | null;
      end_date: string | null;
    }>;
    campaign_services: Array<{ total_paise: number | null }>;
  };

  const rows = (campaigns ?? []) as unknown as CampaignRow[];

  // Compute "Booked value in range" using the same per-site / per-service
  // formula as the campaign-total trigger, so the headline number lines up
  // with the city / location breakdowns below.
  let bookedValueInRange = 0;
  let bookingsInRangeCount = 0;
  for (const c of rows) {
    if (!c.start_date || !c.end_date) continue;

    let campaignShare = 0;

    if (c.pricing_type === "bundled") {
      // Bundled: pro-rate the campaign total by day overlap.
      campaignShare = prorateByRange(
        c.start_date,
        c.end_date,
        c.total_value_paise ?? 0,
        from,
        to,
      );
    } else {
      // Itemized: sum per-site contributions by their rate_type, then
      // add services as a lump sum pro-rated by campaign-level overlap
      // (services don't have their own dates).
      for (const s of c.campaign_sites ?? []) {
        const sf = s.start_date ?? c.start_date;
        const stt = s.end_date ?? c.end_date;
        if (!sf || !stt) continue;
        if (s.rate_type === "per_month") {
          const overlapStart = sf > from ? sf : from;
          const overlapEnd = stt < to ? stt : to;
          if (overlapEnd >= overlapStart) {
            const overlapDays = daysInRange(overlapStart, overlapEnd);
            campaignShare += Math.round(
              ((s.display_rate_paise ?? 0) * overlapDays) / 30,
            );
          }
        } else {
          campaignShare += prorateByRange(
            sf,
            stt,
            s.display_rate_paise ?? 0,
            from,
            to,
          );
        }
      }
      const svcTotal = (c.campaign_services ?? []).reduce(
        (s, r) => s + (r.total_paise ?? 0),
        0,
      );
      if (svcTotal > 0) {
        campaignShare += prorateByRange(
          c.start_date,
          c.end_date,
          svcTotal,
          from,
          to,
        );
      }
    }

    if (campaignShare > 0) {
      bookedValueInRange += campaignShare;
      bookingsInRangeCount += 1;
    }
  }

  // Starting-in-range: campaigns whose start_date is between from and to.
  const startingInRange = rows.filter(
    (c) => c.start_date && c.start_date >= from && c.start_date <= to,
  );
  const startingValue = startingInRange.reduce(
    (s, c) => s + (c.total_value_paise ?? 0),
    0,
  );

  // Ending-in-range: end_date in range.
  const endingInRange = rows.filter(
    (c) => c.end_date && c.end_date >= from && c.end_date <= to,
  );
  // Of those ending, the ones still running are the ones someone can act
  // on. Their value is summed separately: the total of everything ending
  // also counts campaigns that have already come down.
  const endingOpen = endingInRange.filter(
    (c) => c.end_date && c.end_date >= todayStr,
  );
  const endingOpenValue = endingOpen.reduce(
    (s, c) => s + (c.total_value_paise ?? 0),
    0,
  );

  // Live right now — always "today", regardless of range, because the
  // operator always wants to know what's up on their hoardings now.
  const liveCount = (liveToday ?? []).length;
  const liveValue = (liveToday ?? []).reduce(
    (s, c) => s + (c.total_value_paise ?? 0),
    0,
  );

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
      <StatCell
        icon={IndianRupee}
        label={t("booked_in_window")}
        value={inr(bookedValueInRange)}
        sub={t("booked_sub", { count: bookingsInRangeCount })}
        href="/campaigns"
      />
      <StatCell
        icon={RadioTower}
        label={t("live_right_now")}
        value={inr(liveValue)}
        sub={t("live_sub", { count: liveCount })}
        href="/campaigns?status=live"
      />
      <StatCell
        icon={CalendarPlus}
        label={t("starting_in_window")}
        value={String(startingInRange.length)}
        sub={t("starting_sub", { value: inr(startingValue) })}
        href="/campaigns"
      />
      <StatCell
        icon={CalendarX2}
        label={t("ending_in_window")}
        value={String(endingInRange.length)}
        sub={
          endingOpen.length > 0
            ? t("ending_sub_open", {
                count: endingOpen.length,
                value: inr(endingOpenValue),
              })
            : endingInRange.length > 0
              ? t("ending_sub_done")
              : t("ending_sub_none")
        }
        href="/campaigns"
      />
    </div>
  );
}

function StatCell({
  icon: Icon,
  label,
  value,
  sub,
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="glass group flex flex-col gap-3 rounded-2xl p-3.5 transition-colors hover:border-volt/45 sm:flex-row sm:p-4"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-volt/14 text-volt ring-1 ring-inset ring-volt/30">
        <Icon className="size-4" strokeWidth={2} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-white/65">{label}</span>
        <span className="figure mt-1.5 block text-xl text-white sm:text-[22px]">
          {value}
        </span>
        <span className="mt-1.5 block text-xs leading-snug text-white/60">
          {sub}
        </span>
      </span>
    </Link>
  );
}
