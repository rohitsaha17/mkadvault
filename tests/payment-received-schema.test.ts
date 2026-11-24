// Regression test for "Record Payment on an agency-billed invoice
// fails with null-client_id" (Nov 2026 bug).
//
// Covers the three scenarios in the bug report:
//   1. Agency invoice, full payment — amount settles the balance,
//      balanceAfterReceipt flips status to "paid".
//   2. Client invoice with TDS — amount + TDS together close the
//      invoice; the invoice's cash tally only moves by the amount.
//   3. On-account receipt for an agency — client_receipt schema
//      accepts { payer_type: "agency", agency_id: ... } with no
//      client_id and with TDS.
//
// Run with:
//   pnpm test
// or:
//   node --import tsx --test tests/payment-received-schema.test.ts
//
// (Any Node 20+ with tsx registered.)

import test from "node:test";
import assert from "node:assert/strict";
import {
  paymentReceivedSchema,
  balanceAfterReceipt,
} from "../lib/validations/payment-received";
import { clientReceiptSchema } from "../lib/validations/client-receipt";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const AGENCY_ID = "22222222-2222-4222-8222-222222222222";

// Helper that renders a zod error nicely so a failing assert points
// straight at the field that broke.
function issuesOf(result: { success: false; error: { issues: readonly unknown[] } }): string {
  return JSON.stringify(result.error.issues, null, 2);
}

// ─── #1 Agency invoice full payment ──────────────────────────────────────────

test("agency invoice: full payment settles the balance", () => {
  const totalPaise = 118_000_00; // ₹1,18,000 — a typical GST-inclusive invoice
  const parsed = paymentReceivedSchema.safeParse({
    amount_inr: totalPaise / 100,
    tds_inr: 0,
    payment_date: "2026-11-24",
    payment_mode: "bank_transfer",
  });
  assert.equal(
    parsed.success,
    true,
    parsed.success ? "" : issuesOf(parsed as never),
  );

  const result = balanceAfterReceipt({
    totalPaise,
    previousBalancePaise: totalPaise,
    previousAmountPaidPaise: 0,
    amountPaise: totalPaise,
    tdsPaise: 0,
  });

  assert.equal(result.newBalancePaise, 0);
  assert.equal(result.newAmountPaidPaise, totalPaise);
  assert.equal(result.newStatus, "paid");
});

// ─── #2 Client invoice with TDS ──────────────────────────────────────────────

test("client invoice with TDS: amount + TDS settles the balance", () => {
  const totalPaise = 118_000_00; // ₹1,18,000
  const tdsPaise = 10_000_00; // ₹10,000 TDS deducted at source
  const amountPaise = totalPaise - tdsPaise;

  const parsed = paymentReceivedSchema.safeParse({
    amount_inr: amountPaise / 100,
    tds_inr: tdsPaise / 100,
    payment_date: "2026-11-24",
    payment_mode: "bank_transfer",
    reference_number: "UTR123",
  });
  assert.equal(
    parsed.success,
    true,
    parsed.success ? "" : issuesOf(parsed as never),
  );

  const result = balanceAfterReceipt({
    totalPaise,
    previousBalancePaise: totalPaise,
    previousAmountPaidPaise: 0,
    amountPaise,
    tdsPaise,
  });

  // Cash tally only moves by amount — TDS never arrives as cash but
  // still kills the outstanding balance (bug #4).
  assert.equal(result.newAmountPaidPaise, amountPaise);
  assert.equal(result.newBalancePaise, 0);
  assert.equal(result.newStatus, "paid");
});

// A near-settlement that lands one paisa shy of zero: status is still
// "paid" per spec ("mark Paid when balance <= 1"). The shortfall is
// preserved in newBalancePaise so a later reconciliation can decide
// whether to write it off or chase the client.
test("client invoice with TDS: one-paisa shortfall still flips to paid", () => {
  const totalPaise = 118_000_01;
  const amountPaise = 100_000_00;
  const tdsPaise = 18_000_00;
  const result = balanceAfterReceipt({
    totalPaise,
    previousBalancePaise: totalPaise,
    previousAmountPaidPaise: 0,
    amountPaise,
    tdsPaise,
  });
  assert.equal(result.newStatus, "paid");
  // Balance stays at the real residual — never negative, never zeroed
  // out beyond what was actually paid.
  assert.ok(
    result.newBalancePaise >= 0 && result.newBalancePaise <= 1,
    `expected 0-1 paisa residual, got ${result.newBalancePaise}`,
  );
});

// ─── #3 On-account receipt for an agency ─────────────────────────────────────

test("on-account receipt: accepts agency as payer with TDS", () => {
  const parsed = clientReceiptSchema.safeParse({
    payer_type: "agency",
    agency_id: AGENCY_ID,
    // client_id intentionally left blank — the schema should coerce
    // the empty side to undefined and NOT ask for a client UUID.
    client_id: "",
    receipt_date: "2026-11-24",
    amount_inr: 50000,
    payment_mode: "bank_transfer",
    tds_inr: 5000,
  });
  assert.equal(
    parsed.success,
    true,
    parsed.success ? "" : issuesOf(parsed as never),
  );
  if (parsed.success) {
    assert.equal(parsed.data.payer_type, "agency");
    assert.equal(parsed.data.agency_id, AGENCY_ID);
    assert.equal(parsed.data.client_id, undefined);
    assert.equal(parsed.data.tds_inr, 5000);
  }
});

test("on-account receipt: agency payer without agency_id is rejected", () => {
  const parsed = clientReceiptSchema.safeParse({
    payer_type: "agency",
    agency_id: "",
    client_id: "",
    receipt_date: "2026-11-24",
    amount_inr: 50000,
    payment_mode: "bank_transfer",
  });
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    const paths = parsed.error.issues.map((i) => i.path.join("."));
    assert.ok(
      paths.includes("agency_id"),
      `expected agency_id in failing paths, got: ${paths.join(", ")}`,
    );
  }
});

test("on-account receipt: client payer still works unchanged", () => {
  const parsed = clientReceiptSchema.safeParse({
    client_id: CLIENT_ID,
    receipt_date: "2026-11-24",
    amount_inr: 25000,
    payment_mode: "upi",
  });
  assert.equal(
    parsed.success,
    true,
    parsed.success ? "" : issuesOf(parsed as never),
  );
  if (parsed.success) {
    assert.equal(parsed.data.payer_type, "client");
    assert.equal(parsed.data.client_id, CLIENT_ID);
    assert.equal(parsed.data.agency_id, undefined);
  }
});
