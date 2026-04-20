import { z } from "zod";

// Step 1: Basic campaign info
export const campaignBasicsSchema = z.object({
  campaign_name: z.string().min(1, "Campaign name is required"),
  client_id: z.string().uuid("Select a client"),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  pricing_type: z.enum(["itemized", "bundled"]),
  total_value_inr: z.number().positive("Must be positive").optional(),
  notes: z.string().optional(),
});

// Per-site entry in the campaign
export const campaignSiteEntrySchema = z.object({
  site_id: z.string().uuid(),
  rate_type: z.enum(["per_month", "fixed"]),
  display_rate_inr: z.number().min(0, "Enter a display rate").optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

// Per-service entry
export const campaignServiceEntrySchema = z.object({
  service_type: z.enum(["display_rental", "flex_printing", "mounting", "design", "transport", "other"]),
  description: z.string().optional(),
  quantity: z.number().int().min(1),
  rate_inr: z.number().min(0),
  site_id: z.string().uuid().optional(),
  rate_basis: z.enum(["per_sqft", "lumpsum", "other"]),
  other_label: z.string().optional(),
});

// Full campaign creation schema (all steps combined)
export const createCampaignSchema = z.object({
  campaign_name: z.string().min(1, "Campaign name is required"),
  client_id: z.string().uuid("Select a client"),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  pricing_type: z.enum(["itemized", "bundled"]),
  total_value_inr: z.number().positive("Must be positive").optional(),
  notes: z.string().optional(),
  sites: z.array(campaignSiteEntrySchema),
  services: z.array(campaignServiceEntrySchema),
});

export type CampaignBasicsValues = z.infer<typeof campaignBasicsSchema>;
export type CampaignSiteEntry = z.infer<typeof campaignSiteEntrySchema>;
export type CampaignServiceEntry = z.infer<typeof campaignServiceEntrySchema>;
export type CreateCampaignValues = z.infer<typeof createCampaignSchema>;

export const campaignBasicsDefaults: CampaignBasicsValues = {
  campaign_name: "",
  client_id: "",
  pricing_type: "itemized",
};

// Draft campaign schema — only campaign_name required
export const draftCampaignSchema = z.object({
  campaign_name: z.string().min(1, "Campaign name is required to save draft"),
  client_id: z.string().uuid().optional().or(z.literal("")),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  pricing_type: z.enum(["itemized", "bundled"]).optional(),
  total_value_inr: z.number().positive().optional(),
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
