import { z } from "zod";
import {
  optionalNonNegativeNumber,
  optionalPercentage,
  optionalPositiveNumber,
} from "./shared";

// Who the campaign is billed to. See migration 024 for semantics:
//   - client:                    bill client directly (default)
//   - agency:                    bill agency directly
//   - client_on_behalf_of_agency bill client, pay agency a commission
export const BILLING_PARTY_TYPES = [
  "client",
  "agency",
  "client_on_behalf_of_agency",
] as const;
export type BillingPartyType = (typeof BILLING_PARTY_TYPES)[number];

// Shared billing-subfield schema. Cross-field rules applied via superRefine:
//   - billing_party_type === 'client'  → client_id required, agency not required
//   - billing_party_type === 'agency'  → agency required; client_id optional (end customer ref)
//   - billing_party_type === 'client_on_behalf_of_agency' → both required, commission expected
// Note: numeric fields use the shared NaN-safe helpers so the form
// doesn't silently fail when the user types in a value and then clears
// it (which react-hook-form's valueAsNumber turns into NaN, which
// Zod v4's plain z.number().optional() rejects).
const billingFields = {
  billing_party_type: z.enum(BILLING_PARTY_TYPES),
  client_id: z.string().uuid().optional().or(z.literal("")),
  billed_agency_id: z.string().uuid().optional().or(z.literal("")),
  agency_commission_percentage: optionalPercentage,
  agency_commission_inr: optionalNonNegativeNumber,
};

function applyBillingRules(
  data: {
    billing_party_type: BillingPartyType;
    client_id?: string;
    billed_agency_id?: string;
  },
  ctx: z.RefinementCtx,
) {
  if (data.billing_party_type === "client" && !data.client_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["client_id"],
      message: "Select a client",
    });
  }
  if (data.billing_party_type === "agency" && !data.billed_agency_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["billed_agency_id"],
      message: "Select an agency",
    });
  }
  if (data.billing_party_type === "client_on_behalf_of_agency") {
    if (!data.client_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["client_id"],
        message: "Select the end client",
      });
    }
    if (!data.billed_agency_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["billed_agency_id"],
        message: "Select the agency earning the commission",
      });
    }
  }
}

// Step 1: Basic campaign info
export const campaignBasicsSchema = z
  .object({
    campaign_name: z.string().min(1, "Campaign name is required"),
    ...billingFields,
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    pricing_type: z.enum(["itemized", "bundled"]),
    total_value_inr: optionalPositiveNumber,
    notes: z.string().optional(),
  })
  .superRefine(applyBillingRules);

// Per-site entry in the campaign
export const campaignSiteEntrySchema = z.object({
  site_id: z.string().uuid(),
  rate_type: z.enum(["per_month", "fixed"]),
  display_rate_inr: optionalNonNegativeNumber,
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

// Per-service entry. quantity / rate_inr are required but we preprocess
// empty inputs → default safe values so partially-filled service rows
// surface a friendlier error than "Expected number, received nan".
const coerceQuantity = z.preprocess(
  (v) => {
    if (v === undefined || v === null || v === "") return 1;
    if (typeof v === "number" && Number.isNaN(v)) return 1;
    return v;
  },
  z.number().int("Must be a whole number").min(1, "Must be at least 1"),
);
const coerceRate = z.preprocess(
  (v) => {
    if (v === undefined || v === null || v === "") return 0;
    if (typeof v === "number" && Number.isNaN(v)) return 0;
    return v;
  },
  z.number().min(0, "Must be 0 or more"),
);

export const campaignServiceEntrySchema = z.object({
  service_type: z.enum(["display_rental", "flex_printing", "mounting", "design", "transport", "other"]),
  description: z.string().optional(),
  quantity: coerceQuantity,
  rate_inr: coerceRate,
  site_id: z.string().uuid().optional(),
  rate_basis: z.enum(["per_sqft", "lumpsum", "other"]),
  other_label: z.string().optional(),
});

// Full campaign creation schema (all steps combined)
export const createCampaignSchema = z
  .object({
    campaign_name: z.string().min(1, "Campaign name is required"),
    ...billingFields,
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    pricing_type: z.enum(["itemized", "bundled"]),
    total_value_inr: optionalPositiveNumber,
    notes: z.string().optional(),
    sites: z.array(campaignSiteEntrySchema),
    services: z.array(campaignServiceEntrySchema),
  })
  .superRefine(applyBillingRules);

export type CampaignBasicsValues = z.infer<typeof campaignBasicsSchema>;
export type CampaignSiteEntry = z.infer<typeof campaignSiteEntrySchema>;
export type CampaignServiceEntry = z.infer<typeof campaignServiceEntrySchema>;
export type CreateCampaignValues = z.infer<typeof createCampaignSchema>;

export const campaignBasicsDefaults: CampaignBasicsValues = {
  campaign_name: "",
  billing_party_type: "client",
  client_id: "",
  billed_agency_id: "",
  pricing_type: "itemized",
};

// Draft campaign schema — only campaign_name required. Billing fields accepted
// but not cross-validated; we save what we have and enforce on finalize.
export const draftCampaignSchema = z.object({
  campaign_name: z.string().min(1, "Campaign name is required to save draft"),
  billing_party_type: z.enum(BILLING_PARTY_TYPES).optional(),
  client_id: z.string().uuid().optional().or(z.literal("")),
  billed_agency_id: z.string().uuid().optional().or(z.literal("")),
  agency_commission_percentage: optionalPercentage,
  agency_commission_inr: optionalNonNegativeNumber,
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  pricing_type: z.enum(["itemized", "bundled"]).optional(),
  total_value_inr: optionalPositiveNumber,
  notes: z.string().optional(),
  sites: z.array(campaignSiteEntrySchema).optional(),
  services: z.array(campaignServiceEntrySchema).optional(),
});

export type DraftCampaignValues = z.infer<typeof draftCampaignSchema>;

// Change request schemas
export const changeRequestSchema = z.object({
  reason: z.string().min(5, "Please explain what changes are needed"),
});

export const reviewChangeRequestSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  rejection_reason: z.string().optional(),
});

// Schema for updating status — includes cancelled
export const updateCampaignStatusSchema = z.object({
  status: z.enum([
    "enquiry", "proposal_sent", "confirmed", "creative_received",
    "printing", "mounted", "live", "completed", "dismounted", "cancelled",
  ]),
});
