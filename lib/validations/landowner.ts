import { z } from "zod";

const phoneRegex = /^[6-9]\d{9}$/;
const panRegex = /^[A-Z]{5}\d{4}[A-Z]$/;
const pinRegex = /^\d{6}$/;
const ifscRegex = /^[A-Z]{4}0[A-Z\d]{6}$/;

const optionalPhone = z.string()
  .refine((v) => !v || phoneRegex.test(v), { message: "Invalid 10-digit mobile number" })
  .optional().or(z.literal(""));

export const landownerSchema = z.object({
  full_name: z.string().min(1, "Full name is required"),
  phone: optionalPhone,
  phone_alt: optionalPhone,
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pin_code: z.string()
    .refine((v) => !v || pinRegex.test(v), { message: "Invalid 6-digit pin code" })
    .optional().or(z.literal("")),
  pan_number: z.string()
    .refine((v) => !v || panRegex.test(v.toUpperCase()), { message: "Invalid PAN format (e.g. ABCDE1234F)" })
    .optional().or(z.literal("")),
  aadhaar_reference: z.string().optional(),
  bank_name: z.string().optional(),
  bank_account_number: z.string().optional(),
  bank_ifsc: z.string()
    .refine((v) => !v || ifscRegex.test(v.toUpperCase()), { message: "Invalid IFSC format (e.g. SBIN0001234)" })
    .optional().or(z.literal("")),
  notes: z.string().optional(),
});

export type LandownerFormValues = z.infer<typeof landownerSchema>;

export const landownerDefaults: LandownerFormValues = { full_name: "" };
