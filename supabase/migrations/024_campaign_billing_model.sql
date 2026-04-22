-- Migration 024: Campaign billing model — who gets billed, and (when
-- relevant) which agency earns a commission.
--
-- A campaign can be sold under three models:
--   1. 'client'                   — bill the client directly (default, today's behaviour)
--   2. 'agency'                   — bill an agency directly (they pay us, they deal with their client)
--   3. 'client_on_behalf_of_agency' — bill the client, pay the agency a commission separately
--
-- New columns on `campaigns`:
--   billing_party_type           — which of the three models above
--   billed_agency_id             — the agency involved (required for 'agency' and 'client_on_behalf_of_agency')
--   agency_commission_percentage — commission rate (for client_on_behalf_of_agency, usually 10–20)
--   agency_commission_paise      — optional fixed-fee override (used instead of percentage)
--
-- The existing `client_id` stays NOT NULL for historical data, but for
-- 'agency' campaigns we treat it as the end customer (reference only) and
-- the invoice will be raised against the agency, not the client.
-- Apps should look at billing_party_type to decide which invoice to raise.

BEGIN;

-- Add new columns (all nullable / with defaults so existing rows keep working)
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS billing_party_type text
    NOT NULL DEFAULT 'client'
    CHECK (billing_party_type IN ('client', 'agency', 'client_on_behalf_of_agency'));

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS billed_agency_id uuid
    REFERENCES public.partner_agencies(id) ON DELETE RESTRICT;

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS agency_commission_percentage numeric(5,2);

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS agency_commission_paise bigint;

-- Integrity check: if billing_party_type requires an agency, we must have one.
-- Keep this as a check so we fail loud if someone bypasses the app layer.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'campaigns_agency_required_when_needed'
  ) THEN
    ALTER TABLE public.campaigns
      ADD CONSTRAINT campaigns_agency_required_when_needed
      CHECK (
        billing_party_type = 'client'
        OR billed_agency_id IS NOT NULL
      );
  END IF;
END $$;

-- Helpful index for "list all campaigns where we owe agency X commission".
CREATE INDEX IF NOT EXISTS idx_campaigns_billed_agency
  ON public.campaigns(billed_agency_id)
  WHERE billed_agency_id IS NOT NULL;

COMMIT;
