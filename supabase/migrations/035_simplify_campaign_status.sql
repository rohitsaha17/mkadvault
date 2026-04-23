-- Migration 035 — simplify campaigns.status enum
--
-- Drops the full 10-step workflow (enquiry → proposal_sent →
-- confirmed → creative_received → printing → mounted → live →
-- completed / dismounted / cancelled) in favour of just three
-- values:
--
--   live       — booked and within date range (default on create)
--   completed  — end_date has passed (set by auto-complete cron)
--   cancelled  — manually cancelled; sites released
--
-- Data migration for existing rows:
--   * cancelled             → cancelled       (unchanged)
--   * dismounted            → completed       (end of run)
--   * completed             → completed       (unchanged)
--   * any other status      → live            (in-flight, treated as booked)
--
-- We also drop `campaigns.campaign_code` from the workflow check (it
-- had nothing to do with status) — only the status constraint changes.

BEGIN;

-- 1. Migrate existing data to the new values.
UPDATE public.campaigns
  SET status = 'cancelled'
  WHERE status = 'cancelled';

UPDATE public.campaigns
  SET status = 'completed'
  WHERE status IN ('completed', 'dismounted');

UPDATE public.campaigns
  SET status = 'live'
  WHERE status NOT IN ('cancelled', 'completed');

-- 2. Replace the CHECK constraint. Drop the old one by name — pg
--    generates predictable names like `campaigns_status_check` when
--    the column-level CHECK is declared inline.
ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_status_check;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_status_check
  CHECK (status IN ('live', 'completed', 'cancelled'));

-- 3. Default status for new rows (previously 'enquiry').
ALTER TABLE public.campaigns
  ALTER COLUMN status SET DEFAULT 'live';

COMMIT;
