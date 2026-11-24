// Splits a dashboard date range into evenly spaced buckets for the charts.
//
// Every bucket in the range is returned even when nothing happened in it, so
// a quiet month shows as an empty slot instead of vanishing and making the
// trend look smoother than it was. Buckets after today are flagged `future`
// so charts can leave them blank rather than plotting a misleading zero.
//
// All dates are YYYY-MM-DD strings handled as UTC midnights, so a timezone
// can never push a payment into the neighbouring day.

export type BucketUnit = "day" | "week" | "month";

export interface TimeBucket {
  key: string;
  label: string;
  start: string;
  end: string;
  current: boolean;
  future: boolean;
}

const MS_PER_DAY = 86_400_000;

const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Move a YYYY-MM-DD date by whole days. */
export function shiftDate(date: string, days: number): string {
  return toDate(toMs(date) + days * MS_PER_DAY);
}

/** Today's date in India as YYYY-MM-DD, whatever timezone the server runs in. */
export function todayInIndia(): string {
  // en-CA is the locale that formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date(),
  );
}

/** A month of days, a quarter of weeks, anything longer by month. */
export function bucketUnit(from: string, to: string): BucketUnit {
  const days = Math.round((toMs(to) - toMs(from)) / MS_PER_DAY) + 1;
  if (days <= 31) return "day";
  if (days <= 120) return "week";
  return "month";
}

/** Last day of the month a YYYY-MM-DD date falls in. */
export function monthEnd(date: string): string {
  const [year, month] = date.split("-").map(Number);
  return toDate(Date.UTC(year, month, 0));
}

function labelFor(start: string, unit: BucketUnit, locale: string): string {
  const options: Intl.DateTimeFormatOptions =
    unit === "month"
      ? { month: "short", year: "2-digit", timeZone: "UTC" }
      : { day: "numeric", month: "short", timeZone: "UTC" };
  // en-US months stay three letters ("Sep", not "Sept"); en-GB puts the day first.
  const english = unit === "month" ? "en-US" : "en-GB";
  return new Intl.DateTimeFormat(
    locale === "hi" ? "hi-IN" : english,
    options,
  ).format(new Date(toMs(start)));
}

export function buildTimeBuckets({
  from,
  to,
  today,
  locale = "en",
  maxBuckets = 24,
}: {
  from: string;
  to: string;
  today: string;
  locale?: string;
  maxBuckets?: number;
}): TimeBucket[] {
  const unit = bucketUnit(from, to);
  const buckets: TimeBucket[] = [];

  let start = from;
  while (start <= to) {
    const naturalEnd =
      unit === "day"
        ? start
        : unit === "week"
          ? shiftDate(start, 6)
          : monthEnd(start);
    const end = naturalEnd < to ? naturalEnd : to;
    buckets.push({
      key: start,
      label: labelFor(start, unit, locale),
      start,
      end,
      current: start <= today && today <= end,
      future: start > today,
    });
    start = shiftDate(end, 1);
  }

  const cap = unit === "day" ? 31 : maxBuckets;
  if (buckets.length <= cap) return buckets;

  // Very long ranges ("All time" spans twenty years): keep the stretch that
  // ends now, because that is where the data is.
  const lastPast = buckets.findLastIndex((b) => !b.future);
  const endIndex = lastPast === -1 ? cap : Math.max(cap, lastPast + 1);
  return buckets.slice(endIndex - cap, endIndex);
}

/** Totals per bucket, in bucket order. Rows outside the range are ignored. */
export function sumIntoBuckets(
  buckets: TimeBucket[],
  rows: Array<{ date: string | null; value: number }>,
): number[] {
  const totals = buckets.map(() => 0);
  for (const row of rows) {
    if (!row.date) continue;
    const date = row.date.slice(0, 10);
    const index = buckets.findIndex((b) => b.start <= date && date <= b.end);
    if (index !== -1) totals[index] += row.value;
  }
  return totals;
}
