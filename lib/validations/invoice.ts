// Shared invoice validation schema. Lives in /lib so both the server
// action in app/[locale]/(dashboard)/billing/actions.ts and any
// standalone test (see tests/invoice-schema.test.ts) can import it
// without pulling the full Next.js server runtime.
//
// Three recent bugs motivated the permissive shape here:
//   1. Blank campaign dropdown came through as "" and failed `.uuid()`
//      → the preprocessing in emptyToUndefined fixes it.
//   2. Org with no GSTIN on file sent `supplier_gstin: null` which
//      failed `z.string().optional()` ("expected string, received null")
//      → stringNullish accepts null too.
//   3. Blank line-item period dates and "no bank account" fell into
//      the same trap.

import { z } from "zod";

// Treat "" and null as "field is missing" BEFORE the inner schema
// (UUID / string) runs its check. This replaces chains like
// `.uuid().optional()` that reject empty-string / null.
const emptyToUndefined = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), inner);

export const uuidNullish = emptyToUndefined(z.string().uuid().optional());
export const stringNullish = emptyToUndefined(z.string().optional());

// ─── Invoice line item ───────────────────────────────────────────────────────

export const invoiceLineItemSchema = z.object({
  service_type: z.enum([
    "display_rental",
    "flex_printing",
    "mounting",
    "design",
    "transport",
    "other",
  ]),
  description: z.string().min(1, "Description required"),
  hsn_sac_code: z.string().default("998361"),
  quantity: z.number().positive().default(1),
  rate_inr: z.number().min(0),
  period_from: stringNullish,
  period_to: stringNullish,
  site_id: uuidNullish,
  // When an invoice covers several campaigns, each line is tagged with
  // the campaign that produced it so the PDF / list can group by
  // campaign. Single-campaign invoices leave this null.
  campaign_id: uuidNullish,
});

// ─── Full invoice ────────────────────────────────────────────────────────────

export const invoiceSchema = z
  .object({
    // Bill-to side. Exactly one of client_id / billed_agency_id must be
    // set, matching bill_to_type. The DB mirrors this with
    // invoices_bill_to_consistent CHECK (migration 047).
    bill_to_type: z.enum(["client", "agency"]).default("client"),
    client_id: uuidNullish,
    billed_agency_id: uuidNullish,
    campaign_id: uuidNullish,
    invoice_date: z.string().min(1, "Invoice date required"),
    due_date: z.string().min(1, "Due date required"),
    subtotal_inr: z.number().min(0),
    cgst_inr: z.number().min(0).default(0),
    sgst_inr: z.number().min(0).default(0),
    igst_inr: z.number().min(0).default(0),
    total_inr: z.number().min(0),
    supplier_gstin: stringNullish,
    buyer_gstin: stringNullish,
    place_of_supply_state: stringNullish,
    is_inter_state: z.boolean().default(false),
    bank_account_id: uuidNullish,
    external_invoice_number: emptyToUndefined(z.string().max(64).optional()),
    notes: stringNullish,
    terms_and_conditions: stringNullish,
    status: z.enum(["draft", "sent"]).default("draft"),
    line_items: z.array(invoiceLineItemSchema).min(1, "Add at least one line item"),
  })
  .superRefine((d, ctx) => {
    if (d.bill_to_type === "client" && !d.client_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["client_id"],
        message: "Select a client",
      });
    }
    if (d.bill_to_type === "agency" && !d.billed_agency_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["billed_agency_id"],
        message: "Select an agency",
      });
    }
  });

export type InvoiceInput = z.infer<typeof invoiceSchema>;
