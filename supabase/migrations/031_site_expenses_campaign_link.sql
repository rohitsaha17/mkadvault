-- Migration 031 — link payment requests to campaigns
-- Adds an optional campaign_id column to site_expenses so a payment
-- request can be tagged to the campaign it relates to. Useful for:
--   • Filtering campaign-related costs on the campaign P&L
--   • Attribution reporting (cost per campaign)
--   • The "raise payment request from a campaign job" flow (the
--     linked expense already carries the job's campaign context)
-- Still nullable — overhead expenses (office rent, generic cleaning)
-- aren't tied to any campaign.
--
-- ON DELETE SET NULL so cancelling a campaign doesn't nuke the audit
-- trail of its expenses.

BEGIN;

ALTER TABLE public.site_expenses
  ADD COLUMN IF NOT EXISTS campaign_id UUID
  REFERENCES campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_site_expenses_campaign
  ON site_expenses(campaign_id)
  WHERE campaign_id IS NOT NULL AND deleted_at IS NULL;

COMMIT;
