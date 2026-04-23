import { z } from "zod";

// Indian format patterns
const phoneRegex = /^[6-9]\d{9}$/;
const gstinRegex = /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/;
const panRegex = /^[A-Z]{5}\d{4}[A-Z]$/;
const pinRegex = /^\d{6}$/;

const optionalPhone = z.string()
  .refine((v) => !v || phoneRegex.test(v), { message: "Invalid 10-digit mobile number" })
  .optional().or(z.literal(""));

export const clientSchema = z.object({
  company_name: z.string().min(1, "Company name is required"),
  brand_name: z.string().optional(),
  industry_category: z.string().optional(),

  primary_contact_name: z.string().optional(),
  primary_contact_phone: optionalPhone,
  primary_contact_email: z.string().email("Invalid email").optional().or(z.literal("")),

  secondary_contact_name: z.string().optional(),
  secondary_contact_phone: optionalPhone,
  secondary_contact_email: z.string().email("Invalid email").optional().or(z.literal("")),

  billing_contact_name: z.string().optional(),
  billing_contact_phone: optionalPhone,
  billing_contact_email: z.string().email("Invalid email").optional().or(z.literal("")),

  gstin: z.string()
    .refine((v) => !v || gstinRegex.test(v.toUpperCase()), { message: "Invalid GSTIN format (e.g. 27AABCU9603R1ZM)" })
    .optional().or(z.literal("")),
  pan: z.string()
    .refine((v) => !v || panRegex.test(v.toUpperCase()), { message: "Invalid PAN format (e.g. ABCDE1234F)" })
    .optional().or(z.literal("")),
  billing_address: z.string().optional(),
  billing_city: z.string().optional(),
  billing_state: z.string().optional(),
  billing_pin_code: z.string()
    .refine((v) => !v || pinRegex.test(v), { message: "Invalid 6-digit pin code" })
    .optional().or(z.literal("")),

  credit_terms: z.enum(["advance", "net15", "net30", "net60"]),

  notes: z.string().optional(),
});

export type ClientFormValues = z.infer<typeof clientSchema>;

export const clientDefaults: ClientFormValues = {
  company_name: "",
  credit_terms: "advance",
};
