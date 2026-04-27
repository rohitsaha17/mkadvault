-- Migration 042 — keep campaigns.total_value_paise honest with a trigger
-- ─────────────────────────────────────────────────────────────────────────
-- The app's createCampaign / updateCampaign / addCampaignSite / etc.
-- already call lib/campaigns/derive.ts → recomputeCampaignTotalValue
-- on every mutation. But:
--   • A campaign created before that fix landed (April 2026) sat with
--     total_value_paise = NULL even after sites were attached.
--   • Any future code path that bypasses the action layer (raw SQL,
--     external scripts, supabase studio edits) would also leave the
--     stored total drifting from reality.
--
-- A Postgres trigger eliminates both classes of bug — every time a
-- row in campaign_sites or campaign_services is added / updated /
-- removed, we re-derive the parent campaign's total. Bundled
-- campaigns are skipped entirely; their value is the salesperson's
-- opinionated package price, not a roll-up.
--
-- The math mirrors siteTotalPaise + serviceTotalPaise from
-- lib/campaigns/derive.ts. If that helper changes, this trigger has
-- to change too — keep them in lockstep via the comments below.

BEGIN;

-- ─── 1. The recompute function ────────────────────────────────────────────
-- Receives the campaign id from NEW or OLD (whichever the trigger
-- fires on) and rewrites its total. Idempotent — same input always
-- yields the same value, so retries on rollback don't drift.

CREATE OR REPLACE FUNCTION public.recompute_campaign_total_value()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER -- needs to update campaigns row regardless of caller's RLS
SET search_path = public
AS $$
DECLARE
  cid       UUID;
  ptype     TEXT;
  site_sum  BIGINT;
  svc_sum   BIGINT;
BEGIN
  cid := COALESCE(NEW.campaign_id, OLD.campaign_id);
  IF cid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT pricing_type INTO ptype
  FROM campaigns
  WHERE id = cid;

  -- Bundled campaigns don't get auto-recomputed — the package price
  -- is what the salesperson typed and overwriting it would erase
  -- their work.
  IF ptype IS DISTINCT FROM 'itemized' THEN
    RETURN NULL;
  END IF;

  -- Σ per-site totals. For per_month bookings: rate × days / 30 (the
  -- pro-rata rule used everywhere else in the app). For fixed
  -- bookings: rate as-is. Missing / inverted dates fall back to the
  -- flat rate so we never lose data.
  SELECT COALESCE(SUM(
    CASE
      WHEN cs.rate_type = 'fixed' THEN cs.display_rate_paise
      WHEN cs.start_date IS NOT NULL
       AND cs.end_date IS NOT NULL
       AND cs.end_date >= cs.start_date
        THEN ROUND(
          cs.display_rate_paise *
          GREATEST(1, (cs.end_date - cs.start_date + 1)) / 30.0
        )::BIGINT
      ELSE cs.display_rate_paise
    END
  ), 0)
  INTO site_sum
  FROM campaign_sites cs
  WHERE cs.campaign_id = cid;

  SELECT COALESCE(SUM(total_paise), 0)
  INTO svc_sum
  FROM campaign_services
  WHERE campaign_id = cid;

  UPDATE campaigns
     SET total_value_paise = site_sum + svc_sum
   WHERE id = cid;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.recompute_campaign_total_value IS
  'Trigger fn: recomputes campaigns.total_value_paise from campaign_sites + campaign_services. Mirrors siteTotalPaise + serviceTotalPaise in lib/campaigns/derive.ts. Skips bundled campaigns.';

-- ─── 2. Triggers on the two child tables ──────────────────────────────────
-- AFTER triggers so the row change is committed before we read it
-- back in the function. FOR EACH ROW so we recompute precisely the
-- one campaign that changed, not the whole org.

DROP TRIGGER IF EXISTS campaign_sites_recompute_total ON campaign_sites;
CREATE TRIGGER campaign_sites_recompute_total
AFTER INSERT OR UPDATE OR DELETE ON campaign_sites
FOR EACH ROW
EXECUTE FUNCTION public.recompute_campaign_total_value();

DROP TRIGGER IF EXISTS campaign_services_recompute_total ON campaign_services;
CREATE TRIGGER campaign_services_recompute_total
AFTER INSERT OR UPDATE OR DELETE ON campaign_services
FOR EACH ROW
EXECUTE FUNCTION public.recompute_campaign_total_value();

-- ─── 3. One-time backfill of existing campaigns ───────────────────────────
-- Run the same math against every existing itemized campaign to fix
-- pre-trigger drift (e.g. campaigns created in April 2026 before the
-- app-side recompute helper landed).
UPDATE campaigns c
   SET total_value_paise = (
     SELECT COALESCE(SUM(
       CASE
         WHEN cs.rate_type = 'fixed' THEN cs.display_rate_paise
         WHEN cs.start_date IS NOT NULL
          AND cs.end_date IS NOT NULL
          AND cs.end_date >= cs.start_date
           THEN ROUND(
             cs.display_rate_paise *
             GREATEST(1, (cs.end_date - cs.start_date + 1)) / 30.0
           )::BIGINT
         ELSE cs.display_rate_paise
       END
     ), 0) AS site_sum
     FROM campaign_sites cs
     WHERE cs.campaign_id = c.id
   ) + COALESCE(
     (SELECT SUM(total_paise) FROM campaign_services WHERE campaign_id = c.id),
     0
   )
 WHERE c.pricing_type = 'itemized'
   AND c.deleted_at IS NULL;

COMMIT;
