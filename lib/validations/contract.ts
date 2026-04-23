import { z } from "zod";
import {
  optionalPercentage,
  optionalPositiveNumber,
} from "./shared";

// NaN-safe optional integer helper for the day-of-month / period fields.
// react-hook-form's valueAsNumber turns a cleared input into NaN, which
// plain z.number().int() rejects with a confusing message.
function optionalInt(min?: number, max?: number, label?: string) {
  let schema = z.number().int("Must be a whole number");
  if (min !== undefined) schema = schema.min(min, label ?? `Must be ≥ ${min}`);
  if (max !== undefined) schema = schema.max(max, label ?? `Must be ≤ ${max}`);
  return z.preprocess(
    (v) => {
      if (v === undefined || v === null || v === "") return undefined;
      if (typeof v === "number" && Number.isNaN(v)) return undefined;
      return v;
    },
    schema.optional(),
  );
}

// Base contract schema — conditional fields validated in the action based on payment_model
export const contractSchema = z.object({
  contract_type: z.enum(["landowner", "agency"]),
  landowner_id: z.string().uuid().optional(),
  agency_id: z.string().uuid().optional(),
  site_id: z.string().uuid("Select a site"),

  payment_model: z.enum(["monthly_fixed", "yearly_lumpsum", "revenue_share", "custom"]),

  // Monthly fixed / revenue share minimum
  rent_amount_inr: optionalPositiveNumber,
  payment_day_of_month: optionalInt(1, 28),

  // Yearly lumpsum
  payment_date: z.string().optional(), // ISO date

  // Revenue share
  revenue_share_percentage: optionalPercentage,
  minimum_guarantee_inr: optionalPositiveNumber,

  // Escalation
  escalation_percentage: optionalPercentage,
  escalation_frequency_months: optionalInt(1),

  // Term
  start_date: z.string().min(1, "Start date is required"),
  end_date: z.string().optional(),
  renewal_date: z.string().optional(),
  notice_period_days: optionalInt(1),
  lock_period_months: optionalInt(1),
  early_termination_clause: z.string().optional(),

  notes: z.string().optional(),

  // Free-form T&C clauses — stored as JSONB on the contract row. Each clause
  // is a titled paragraph. Order is preserved by array index.
  terms_clauses: z
    .array(
      z.object({
        title: z.string().min(1, "Clause title required").max(200),
        content: z.string().min(1, "Clause content required"),
      }),
    )
    .optional(),
}).refine((d) => {
  if (d.contract_type === "landowner" && !d.landowner_id) return false;
  if (d.contract_type === "agency" && !d.agency_id) return false;
  return true;
}, { message: "Select a landowner or agency based on contract type" });

export type ContractFormValues = z.infer<typeof contractSchema>;

export const contractDefaults: Partial<ContractFormValues> = {
  contract_type: "landowner",
  payment_model: "monthly_fixed",
  notice_period_days: 90,
  escalation_frequency_months: 12,
  start_date: "",
};

// Schema for recording a payment against a contract_payments row.
// tds_percentage is optional and frequently cleared — use the NaN-safe
// helper so re-typing and deleting doesn't block the submit.
const optionalTdsPercentage = z.preprocess(
  (v) => {
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v === "number" && Number.isNaN(v)) return undefined;
    return v;
  },
  z.number().min(0, "Must be 0 or more").max(30, "Cannot exceed 30%").optional(),
);

// amount_paid_inr is required — coerce NaN → 0 so the zod error reads
// "Amount must be positive" instead of "Expected number, received nan".
const requiredPositive = z.preprocess(
  (v) => {
    if (v === undefined || v === null || v === "") return 0;
    if (typeof v === "number" && Number.isNaN(v)) return 0;
    return v;
  },
  z.number().positive("Amount must be positive"),
);

export const recordPaymentSchema = z.object({
  amount_paid_inr: requiredPositive,
  payment_date: z.string().min(1, "Payment date is required"),
  payment_mode: z.enum(["cash", "cheque", "bank_transfer", "upi", "online"]),
  payment_reference: z.string().optional(),
  tds_percentage: optionalTdsPercentage,
  notes: z.string().optional(),
});

export type RecordPaymentValues = z.infer<typeof recordPaymentSchema>;

// Schema for a standalone signed agreement (not linked to a full contract)
export const signedAgreementSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  counterparty_type: z.enum(["landowner", "agency", "client", "other"]).optional(),
  landowner_id: z.string().uuid().optional(),
  agency_id: z.string().uuid().optional(),
  client_id: z.string().uuid().optional(),
  site_id: z.string().uuid().optional(),
  agreement_date: z.string().optional(),
  notes: z.string().optional(),
});

export type SignedAgreementValues = z.infer<typeof signedAgreementSchema>;
