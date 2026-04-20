import { z } from "zod";

const phoneRegex = /^[6-9]\d{9}$/;
const gstinRegex = /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/;

export const agencySchema = z.object({
  agency_name: z.string().min(1, "Agency name is required"),
  contact_person: z.string().optional(),
  phone: z.string()
    .refine((v) => !v || phoneRegex.test(v), { message: "Invalid 10-digit mobile number" })
    .optional().or(z.literal("")),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  gstin: z.string()
    .refine((v) => !v || gstinRegex.test(v.toUpperCase()), { message: "Invalid GSTIN format (e.g. 27AABCU9603R1ZM)" })
    .optional().or(z.literal("")),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  notes: z.string().optional(),
});

export type AgencyFormValues = z.infer<typeof agencySchema>;

export const agencyDefaults: AgencyFormValues = { agency_name: "" };
