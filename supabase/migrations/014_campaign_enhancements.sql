-- 014_campaign_enhancements.sql
-- Add rate_type to campaign_sites for per-month vs fixed pricing
-- Add rate_basis to campaign_services for sqft/lumpsum/other pricing

-- Campaign sites: rate type
ALTER TABLE campaign_sites ADD COLUMN IF NOT EXISTS rate_type text NOT NULL DEFAULT 'fixed';
-- Values: 'per_month' (monthly rate, auto-calc for duration), 'fixed' (flat amount)

-- Campaign services: rate basis
ALTER TABLE campaign_services ADD COLUMN IF NOT EXISTS rate_basis text NOT NULL DEFAULT 'lumpsum';
-- Values: 'per_sqft' (rate × site sqft), 'lumpsum' (flat), 'other' (custom label)
ALTER TABLE campaign_services ADD COLUMN IF NOT EXISTS other_label text;
