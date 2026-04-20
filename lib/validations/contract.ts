import { z } from "zod";

// Base contract schema — conditional fields validated in the action based on payment_model
export const contractSchema = z.object({
  contract_type: z.enum(["landowner", "agency"]),
  landowner_id: z.string().uuid().optional(),
  agency_id: z.string().uuid().optional(),
  site_id: z.string().uuid("Select a site"),

  payment_model: z.enum(["monthly_fixed", "yearly_lumpsum", "revenue_share", "custom"]),

  // Monthly fixed / revenue share minimum
  rent_amount_inr: z.number().positive("Must be positive").optional(),
  payment_day_of_month: z.number().int().min(1).max(28).optional(),

  // Yearly lumpsum
  payment_date: z.string().optional(), // ISO date

  // Revenue share
  revenue_share_percentage: z.number().min(0).max(100).optional(),
  minimum_guarantee_inr: z.number().positive("Must be positive").optional(),

  // Escalation
  escalation_percentage: z.number().min(0).max(100).optional(),
  escalation_frequency_months: z.number().int().positive().optional(),

  // Term
  start_date: z.string().min(1, "Start date is required"),
  end_date: z.string().optional(),
  renewal_date: z.string().optional(),
  notice_period_days: z.number().int().positive().optional(),
  lock_period_months: z.number().int().positive().optional(),
  early_termination_clause: z.string().optional(),

  notes: z.string().optional(),
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

// Schema for recording a payment against a contract_payments row
export const recordPaymentSchema = z.object({
  amount_paid_inr: z.number().positive("Amount must be positive"),
  payment_date: z.string().min(1, "Payment date is required"),
  payment_mode: z.enum(["cash", "cheque", "bank_transfer", "upi", "online"]),
  payment_reference: z.string().optional(),
  tds_percentage: z.number().min(0).max(30).optional(),
  notes: z.string().optional(),
});

export type RecordPaymentValues = z.infer<typeof recordPaymentSchema>;
