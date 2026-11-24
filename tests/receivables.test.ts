import test from "node:test";
import assert from "node:assert/strict";
import {
  ageBucket,
  invoiceState,
  summariseReceivables,
  type ReceivableRow,
} from "../lib/receivables";

const TODAY = "2026-11-25";
const inv = (due_date: string | null, over: Partial<ReceivableRow> = {}): ReceivableRow => ({
  status: "sent",
  due_date,
  balance_due_paise: 1000,
  ...over,
});

test("a sent invoice past its date is overdue without any status change", () => {
  const s = summariseReceivables([inv("2026-11-24")], TODAY);
  assert.deepEqual([s.overdue, s.overdueCount], [1000, 1]);
  assert.equal(invoiceState(inv("2026-11-24"), TODAY), "overdue");
});

test("a part-paid late invoice counts only its balance", () => {
  const late = inv("2026-08-01", { status: "partially_paid", balance_due_paise: 300 });
  assert.equal(summariseReceivables([late], TODAY).overdue, 300);
  assert.equal(invoiceState(late, TODAY), "overdue");
});

test("due today is not overdue", () => {
  assert.equal(invoiceState(inv(TODAY), TODAY), "sent");
  assert.equal(summariseReceivables([inv(TODAY)], TODAY).overdue, 0);
});

test("drafts, paid and cancelled invoices never count", () => {
  const rows = ["draft", "paid", "cancelled"].map((status) => inv("2026-01-01", { status }));
  const s = summariseReceivables(rows, TODAY);
  assert.deepEqual([s.outstanding, s.overdue], [0, 0]);
  assert.equal(invoiceState(rows[1], TODAY), "paid");
});

test("a settled balance, missing date or stale overdue status is not overdue", () => {
  assert.equal(invoiceState(inv("2026-01-01", { balance_due_paise: 0 }), TODAY), "sent");
  assert.equal(invoiceState(inv(null), TODAY), "sent");
  assert.equal(invoiceState(inv("2026-12-05", { status: "overdue" }), TODAY), "sent");
});

test("a list that doesn't load balances still shows a late invoice as overdue", () => {
  assert.equal(invoiceState({ status: "sent", due_date: "2026-11-01" }, TODAY), "overdue");
});

test("age buckets split at 30, 60 and 90 days late", () => {
  const cases: Array<[string, string]> = [
    ["2026-11-26", "notDue"], [TODAY, "notDue"], ["2026-11-24", "d1to30"],
    ["2026-10-26", "d1to30"], ["2026-10-25", "d31to60"], ["2026-09-26", "d31to60"],
    ["2026-09-25", "d61to90"], ["2026-08-27", "d61to90"], ["2026-08-26", "d90plus"],
  ];
  for (const [date, bucket] of cases) assert.equal(ageBucket(date, TODAY), bucket, date);
});

test("ageing adds up to outstanding, and late buckets add up to overdue", () => {
  const rows = ["2026-12-21", TODAY, "2026-11-11", "2026-10-10", "2026-09-05", "2026-06-01"].map((d) => inv(d));
  const s = summariseReceivables(rows, TODAY);
  const all = Object.values(s.ageing).reduce((a, b) => a + b, 0);
  assert.equal(all, s.outstanding);
  assert.equal(all - s.ageing.notDue, s.overdue);
  assert.equal(s.overdueCount, 4);
});
