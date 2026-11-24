import test from "node:test";
import assert from "node:assert/strict";
import {
  payableBalance,
  payableState,
  summarisePayables,
  type PayableRow,
} from "../lib/payables";
import { monthEnd, shiftDate } from "../lib/utils/time-buckets";

const TODAY = "2026-11-25";
const RENT = 2_200_000; // ₹22,000 in paise

const row = (due_date: string, over: Partial<PayableRow> = {}): PayableRow => ({
  due_date,
  amount_due_paise: RENT,
  amount_paid_paise: null,
  tds_deducted_paise: null,
  status: "upcoming",
  ...over,
});
const paid = (due_date: string) =>
  row(due_date, { status: "paid", amount_paid_paise: RENT });

test("the real contract: six paid, two late, one due soon, the rest later", () => {
  const months = ["04", "05", "06", "07", "08", "09"];
  const rows = [
    ...months.map((m) => paid(`2026-${m}-05`)),
    row("2026-10-05", { status: "due" }),
    row("2026-11-05", { status: "due" }),
    row("2026-12-05"),
    ...Array.from({ length: 15 }, (_, i) =>
      row(`${2027 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-05`),
    ),
  ];
  assert.equal(rows.length, 24);
  const s = summarisePayables(rows, TODAY);
  assert.equal(s.overdue, 2 * RENT); // was shown as ₹0
  assert.equal(s.overdueCount, 2);
  assert.equal(s.oldestOverdue, "2026-10-05");
  assert.equal(s.dueSoon, RENT);
  assert.equal(s.dueSoonCount, 1);
  assert.equal(s.later, 15 * RENT);
});

test("a row stored as upcoming becomes overdue once its date has passed", () => {
  const stale = row("2026-11-24", { status: "upcoming" });
  assert.equal(payableState(stale, TODAY), "overdue");
  assert.equal(summarisePayables([stale], TODAY).overdue, RENT);
});

test("a stale 'overdue' status on a future date does not count as overdue", () => {
  const s = summarisePayables([row("2026-12-01", { status: "overdue" })], TODAY);
  assert.equal(s.overdue, 0);
  assert.equal(s.dueSoon, RENT);
});

test("due today is due, not overdue", () => {
  assert.equal(payableState(row(TODAY), TODAY), "due");
  const s = summarisePayables([row(TODAY)], TODAY);
  assert.equal(s.overdue, 0);
  assert.equal(s.dueSoon, RENT);
});

test("the window ends on day 30", () => {
  assert.equal(shiftDate(TODAY, 30), "2026-12-25");
  const s = summarisePayables([row("2026-12-25"), row("2026-12-26")], TODAY);
  assert.equal(s.dueSoon, RENT);
  assert.equal(s.later, RENT);
});

test("a part-payment leaves only the balance", () => {
  const part = row("2026-11-05", {
    status: "partially_paid",
    amount_paid_paise: 1_500_000,
    tds_deducted_paise: 100_000,
  });
  assert.equal(payableBalance(part), 600_000);
  assert.equal(payableState(part, TODAY), "overdue");
  assert.equal(
    payableState({ ...part, due_date: "2026-12-05" }, TODAY),
    "partially_paid",
  );
});

test("payment plus TDS that covers the rent is settled, and never negative", () => {
  const settled = row("2026-11-05", {
    status: "partially_paid",
    amount_paid_paise: 1_980_000,
    tds_deducted_paise: 220_000,
  });
  assert.equal(payableBalance(settled), 0);
  assert.equal(payableState(settled, TODAY), "paid");
  const over = row("2026-11-05", {
    status: "partially_paid",
    amount_paid_paise: RENT,
    tds_deducted_paise: 220_000,
  });
  assert.equal(payableBalance(over), 0);
});

test("paid rows never count, and a zero-rent row is not called paid", () => {
  assert.equal(summarisePayables([paid("2026-01-05")], TODAY).overdue, 0);
  const free = row("2026-12-05", { amount_due_paise: 0 });
  assert.equal(payableState(free, TODAY), "upcoming");
  assert.equal(summarisePayables([free], TODAY).dueSoonCount, 0);
});

test("every unpaid rupee is counted exactly once, whatever the stored status", () => {
  const statuses = ["upcoming", "due", "overdue", "partially_paid"];
  const dates = ["2025-03-31", "2026-11-24", TODAY, "2026-12-25", "2026-12-26", "2028-03-05"];
  const rows = statuses.flatMap((status) => dates.map((d) => row(d, { status })));
  const s = summarisePayables(rows, TODAY);
  assert.equal(s.overdue + s.dueSoon + s.later, rows.length * RENT);
});

test("month end is a real date in every month", () => {
  assert.equal(monthEnd("2026-11-25"), "2026-11-30");
  assert.equal(monthEnd("2026-02-10"), "2026-02-28");
  assert.equal(monthEnd("2028-02-10"), "2028-02-29");
  assert.equal(monthEnd("2026-12-31"), "2026-12-31");
});
