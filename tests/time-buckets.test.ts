import test from "node:test";
import assert from "node:assert/strict";
import {
  bucketUnit,
  buildTimeBuckets,
  sumIntoBuckets,
} from "../lib/utils/time-buckets";

const FY = { from: "2026-04-01", to: "2027-03-31", today: "2026-11-25" };

test("a financial year gives twelve months, including the quiet and future ones", () => {
  const buckets = buildTimeBuckets(FY);
  assert.equal(buckets.length, 12);
  assert.equal(buckets[0].label, "Apr 26");
  assert.equal(buckets[0].end, "2026-04-30");
  assert.equal(buckets[11].label, "Mar 27");
  assert.equal(buckets[11].end, "2027-03-31");
  assert.equal(buckets.filter((b) => b.current).length, 1);
  assert.equal(buckets.find((b) => b.current)?.label, "Nov 26");
  assert.equal(buckets.filter((b) => b.future).length, 4);
});

test("a month is split by day and a quarter by week", () => {
  assert.equal(bucketUnit("2026-11-01", "2026-11-30"), "day");
  assert.equal(bucketUnit("2026-10-01", "2026-12-31"), "week");
  const days = buildTimeBuckets({
    from: "2026-11-01",
    to: "2026-11-30",
    today: "2026-11-25",
  });
  assert.equal(days.length, 30);
  const weeks = buildTimeBuckets({
    from: "2026-10-01",
    to: "2026-12-31",
    today: "2026-11-25",
  });
  assert.equal(weeks.length, 14);
  assert.equal(weeks.at(-1)?.end, "2026-12-31");
});

test("buckets cover the range with no gaps or overlaps", () => {
  for (const range of [
    FY,
    { from: "2026-10-01", to: "2026-12-31", today: "2026-11-25" },
    { from: "2026-02-10", to: "2026-03-05", today: "2026-11-25" },
    { from: "2028-01-15", to: "2028-09-20", today: "2026-11-25" },
  ]) {
    const buckets = buildTimeBuckets(range);
    assert.equal(buckets[0].start, range.from);
    assert.equal(buckets.at(-1)?.end, range.to);
    for (let i = 1; i < buckets.length; i++) {
      const gap =
        Date.parse(buckets[i].start) - Date.parse(buckets[i - 1].end);
      assert.equal(gap, 86_400_000);
    }
  }
});

test("a single day is one bucket", () => {
  const buckets = buildTimeBuckets({
    from: "2026-11-25",
    to: "2026-11-25",
    today: "2026-11-25",
  });
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].current, true);
});

test("all time keeps the 24 months that end now, not the first 24", () => {
  const buckets = buildTimeBuckets({
    from: "2016-01-01",
    to: "2036-12-31",
    today: "2026-11-25",
  });
  assert.equal(buckets.length, 24);
  assert.equal(buckets.at(-1)?.label, "Nov 26");
  assert.equal(buckets[0].label, "Dec 24");
});

test("a range entirely in the future still returns buckets", () => {
  const buckets = buildTimeBuckets({
    from: "2030-01-01",
    to: "2036-12-31",
    today: "2026-11-25",
  });
  assert.equal(buckets.length, 24);
  assert.equal(buckets[0].start, "2030-01-01");
  assert.ok(buckets.every((b) => b.future));
});

test("totals land in the right bucket and nothing is lost inside the range", () => {
  const buckets = buildTimeBuckets(FY);
  const totals = sumIntoBuckets(buckets, [
    { date: "2026-04-01", value: 100 },
    { date: "2026-04-30", value: 50 },
    { date: "2026-05-01", value: 7 },
    { date: "2026-11-25T18:45:00+00:00", value: 30 },
    { date: "2027-03-31", value: 1 },
    { date: "2026-03-31", value: 9999 },
    { date: "2027-04-01", value: 9999 },
    { date: null, value: 9999 },
  ]);
  assert.equal(totals[0], 150);
  assert.equal(totals[1], 7);
  assert.equal(totals[2], 0);
  assert.equal(totals[7], 30);
  assert.equal(totals[11], 1);
  assert.equal(totals.reduce((a, b) => a + b, 0), 188);
});
