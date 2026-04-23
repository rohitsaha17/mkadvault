// Zod schemas for site_expenses mutations.
// Mirrors the CHECK constraints on the site_expenses table so the server
// action and the form share one source of truth.
import { z } from "zod";

export const expenseCategoryEnum = z.enum([
  "electricity",
  "rent",
  "maintenance",
  "cleaning",
  "light_change",
  "repair",
  "permit_fee",
  "printing",
  "mounting",
  "fuel_transport",
  "other",
]);

export const expensePayeeTypeEnum = z.enum([
  "landowner",
  "agency",
  "vendor",
  "contractor",
  "employee",
  "other",
]);

export const expenseStatusEnum = z.enum([
  "pending",
  "approved",
  "paid",
  "rejected",
]);

export const paymentModeEnum = z.enum([
  "cash",
  "cheque",
  "bank_transfer",
  "upi",
  "online",
]);

// ── Create a payment request ────────────────────────────────────────────────
// Rates are entered in rupees by the user; the server action converts to
// paise. Site id is optional so overhead (office rent, software) can still
// be logged.
export const expenseCreateSchema = z.object({
  site_id: z.string().uuid().nullable().optional(),
  // Optional — tag the request to a specific campaign for P&L attribution.
  // Can be combined with site_id (this expense is for site X, campaign Y)
  // or left null for overhead expenses unrelated to a campaign.
  campaign_id: z.string().uuid().nullable().optional(),
  category: expenseCategoryEnum,
  description: z.string().trim().min(3, "Give a one-line description").max(500),
  amount_rupees: z
    .number({ message: "Amount must be a number" })
    .positive("Amount must be greater than 0")
    .max(1_00_00_00_000, "Amount looks too large"),

  payee_type: expensePayeeTypeEnum,
  payee_id: z.string().uuid().nullable().optional(),
  payee_name: z.string().trim().min(1, "Payee name is required").max(200),
  payee_contact: z
    .string()
    .trim()
    .max(200)
    .optional()
    .or(z.literal("").transform(() => undefined)),

  // Bank details are optional and flexible — treated as opaque JSON.
  payee_bank_details: z
    .object({
      bank: z.string().optional(),
      account_number: z.string().optional(),
      ifsc: z.string().optional(),
      upi: z.string().optional(),
    })
    .partial()
    .nullable()
    .optional(),

  needed_by: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),

  notes: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),

  // Storage paths (already uploaded) — no binary data travels through the action.
  receipt_doc_urls: z.array(z.string()).max(10).default([]),
});

export type ExpenseCreateValues = z.infer<typeof expenseCreateSchema>;

// ── Mark paid ────────────────────────────────────────────────────────────────
export const expenseMarkPaidSchema = z.object({
  expense_id: z.string().uuid(),
  paid_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  payment_mode: paymentModeEnum,
  payment_reference: z
    .string()
    .trim()
    .max(200)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  tds_rupees: z
    .number()
    .min(0, "TDS cannot be negative")
    .nullable()
    .optional(),
  payment_proof_urls: z.array(z.string()).max(10).default([]),
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type ExpenseMarkPaidValues = z.infer<typeof expenseMarkPaidSchema>;

// ── Status transitions other than "mark paid" ───────────────────────────────
export const expenseSetStatusSchema = z.object({
  expense_id: z.string().uuid(),
  status: z.enum(["pending", "approved", "rejected"]),
});

export type ExpenseSetStatusValues = z.infer<typeof expenseSetStatusSchema>;
