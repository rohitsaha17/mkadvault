import { z } from "zod";

// ─── Profile schema ────────────────────────────────────────────────────────────

export const profileSchema = z.object({
  full_name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be 100 characters or fewer"),
  phone: z
    .string()
    .max(20, "Phone number too long")
    .regex(/^[+\d\s\-()]*$/, "Invalid phone number")
    .optional()
    .or(z.literal("")),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;

// ─── Organisation schema ───────────────────────────────────────────────────────

export const orgSettingsSchema = z.object({
  name: z
    .string()
    .min(1, "Organisation name is required")
    .max(200, "Name must be 200 characters or fewer"),
  address: z.string().max(500).optional().or(z.literal("")),
  city: z.string().max(100).optional().or(z.literal("")),
  state: z.string().max(100).optional().or(z.literal("")),
  pin_code: z
    .string()
    .regex(/^\d{6}$/, "Pin code must be 6 digits")
    .optional()
    .or(z.literal("")),
  phone: z
    .string()
    .max(20, "Phone number too long")
    .regex(/^[+\d\s\-()]*$/, "Invalid phone number")
    .optional()
    .or(z.literal("")),
  email: z
    .string()
    .email("Invalid email address")
    .optional()
    .or(z.literal("")),
  gstin: z
    .string()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, "Invalid GSTIN format")
    .optional()
    .or(z.literal("")),
  pan: z
    .string()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, "Invalid PAN format (e.g. AABCU9603R)")
    .optional()
    .or(z.literal("")),
  // Per-document T&C templates (migration 040). Each one pre-fills the
  // corresponding document builder; blank = no template, users can still
  // type custom terms per document. All optional, same 10k cap.
  invoice_terms_template: z
    .string()
    .max(10000, "Terms are too long — keep under 10,000 characters")
    .optional()
    .or(z.literal("")),
  rate_card_terms_template: z
    .string()
    .max(10000, "Terms are too long — keep under 10,000 characters")
    .optional()
    .or(z.literal("")),
  payment_voucher_terms_template: z
    .string()
    .max(10000, "Terms are too long — keep under 10,000 characters")
    .optional()
    .or(z.literal("")),
  receipt_voucher_terms_template: z
    .string()
    .max(10000, "Terms are too long — keep under 10,000 characters")
    .optional()
    .or(z.literal("")),
});

export type OrgSettingsFormValues = z.infer<typeof orgSettingsSchema>;
