// Regression test for the "Create Invoice" schema.
//
// Reproduces the Nov 2026 bug:
//
//   • With Campaign left blank, Save as Draft fails with "Invalid UUID"
//   • With a campaign selected but no org bank account on file, save
//     fails with "Invalid input: expected string, received null"
//
// Both came from `.uuid().optional()` / `z.string().optional()` chains
// that refused empty-string and null. The schema in
// lib/validations/invoice.ts now preprocesses those values to
// undefined, so this payload should parse cleanly.
//
// Run with:
//   node --import tsx --test tests/invoice-schema.test.ts
//
// (Or any Node 20+ with ts-node / tsx registered.)

import test from "node:test";
import assert from "node:assert/strict";
import { invoiceSchema } from "../lib/validations/invoice";

// A realistic "draft invoice, blank everything else" payload shaped
// EXACTLY as InvoiceForm.tsx builds it for the server action:
//   - no campaign
//   - no bank account on file
//   - line periods blank
//   - org has no GSTIN on file → supplier_gstin: null
//   - client GSTIN missing → buyer_gstin: null
// Valid v4 UUIDs — zod v4 enforces version/variant nibbles strictly, so
// "11111111-…" is rejected. These are plain fixtures, not real rows.
const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const AGENCY_ID = "22222222-2222-4222-8222-222222222222";
const CAMPAIGN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CAMPAIGN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const draftPayload = {
  bill_to_type: "client",
  client_id: CLIENT_ID,
  billed_agency_id: "",
  campaign_id: "",
  invoice_date: "2026-11-23",
  due_date: "2026-12-23",
  subtotal_inr: 100000,
  cgst_inr: 9000,
  sgst_inr: 9000,
  igst_inr: 0,
  total_inr: 118000,
  supplier_gstin: null,
  buyer_gstin: null,
  place_of_supply_state: "",
  is_inter_state: false,
  bank_account_id: "",
  external_invoice_number: "",
  notes: "",
  terms_and_conditions: "Payment due within 30 days.",
  status: "draft",
  line_items: [
    {
      service_type: "display_rental",
      description: "One hoarding, Nov 2026",
      hsn_sac_code: "998361",
      quantity: 30,
      rate_inr: 3333.33,
      period_from: "",
      period_to: "",
      site_id: "",
      campaign_id: "",
    },
  ],
};

// Shallow helper so an unexpected failure prints WHY, not just a bare
// "false !== true".
function issuesOf(result: { success: boolean; error?: { issues: unknown[] } }): string {
  return result.success ? "ok" : JSON.stringify(result.error?.issues ?? [], null, 2);
}

test("invoiceSchema accepts a draft with no campaign, no bank, blank line periods", () => {
  const result = invoiceSchema.safeParse(draftPayload);
  assert.equal(result.success, true, issuesOf(result));
  if (!result.success) return; // narrow for TS below
  assert.equal(result.data.campaign_id, undefined);
  assert.equal(result.data.bank_account_id, undefined);
  assert.equal(result.data.supplier_gstin, undefined);
  assert.equal(result.data.buyer_gstin, undefined);
  assert.equal(result.data.line_items[0].period_from, undefined);
  assert.equal(result.data.line_items[0].period_to, undefined);
  assert.equal(result.data.line_items[0].site_id, undefined);
});

test("invoiceSchema rejects client bill-to with no client_id and names the field", () => {
  const bad = { ...draftPayload, client_id: "" };
  const result = invoiceSchema.safeParse(bad);
  assert.equal(result.success, false);
  if (result.success) return;
  const firstIssue = result.error.issues[0];
  assert.deepEqual(firstIssue.path, ["client_id"]);
  assert.equal(firstIssue.message, "Select a client");
});

test("invoiceSchema accepts an agency bill-to with billed_agency_id instead of client_id", () => {
  const agencyPayload = {
    ...draftPayload,
    bill_to_type: "agency",
    client_id: "",
    billed_agency_id: AGENCY_ID,
  };
  const result = invoiceSchema.safeParse(agencyPayload);
  assert.equal(result.success, true, issuesOf(result));
  if (!result.success) return;
  assert.equal(result.data.bill_to_type, "agency");
  assert.equal(result.data.client_id, undefined);
  assert.equal(result.data.billed_agency_id, AGENCY_ID);
});

test("invoiceSchema surfaces the field path on a validation failure", () => {
  const bad = {
    ...draftPayload,
    due_date: "", // required
  };
  const result = invoiceSchema.safeParse(bad);
  assert.equal(result.success, false);
  if (result.success) return;
  const i = result.error.issues[0];
  // The Create-Invoice server action composes the toast as
  //   `${issue.path.join(".")}: ${issue.message}`
  // so a non-empty path is what lets users see WHICH field is wrong.
  assert.ok(i.path.length > 0, "expected the issue path to be set");
  assert.equal(i.path[0], "due_date");
});

test("invoiceSchema supports multi-campaign line items (each tagged)", () => {
  const multi = {
    ...draftPayload,
    line_items: [
      {
        ...draftPayload.line_items[0],
        description: "[Campaign A] Hoarding 1",
        campaign_id: CAMPAIGN_A,
      },
      {
        ...draftPayload.line_items[0],
        description: "[Campaign B] Hoarding 2",
        campaign_id: CAMPAIGN_B,
      },
    ],
  };
  const result = invoiceSchema.safeParse(multi);
  assert.equal(result.success, true, issuesOf(result));
  if (!result.success) return;
  const ids = result.data.line_items.map((li) => li.campaign_id);
  assert.deepEqual(
    [...new Set(ids)].length,
    2,
    "each line should keep its own campaign_id",
  );
});
