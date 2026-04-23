-- Migration 034 — link site_photos to campaigns
-- Campaign executives upload post-mounting photos for each booked site
-- under a campaign. These need to appear both on the campaign detail
-- page (grouped by campaign_site) AND on the site detail page
-- (alongside the site's own reference photos) so future buyers / ops
-- teams see real-world shots of how the hoarding looks in use.
--
-- Approach: reuse the site_photos table — photos are ALWAYS tied to a
-- site regardless of source. Add optional campaign_id + campaign_site_id
-- pointers so a site photo can carry campaign provenance.
--
--   campaign_id IS NULL       → plain site photo (reference / day shot)
--   campaign_id IS NOT NULL   → uploaded against a live campaign
--   campaign_site_id          → narrows to a specific campaign-site
--                               row (useful for date-ranged bookings)
--
-- Deleting a campaign should NOT cascade-delete the photos — they're
-- still valid site photos. So both FKs use ON DELETE SET NULL.

BEGIN;

ALTER TABLE public.site_photos
  ADD COLUMN campaign_id      UUID
    REFERENCES campaigns(id) ON DELETE SET NULL,
  ADD COLUMN campaign_site_id UUID
    REFERENCES campaign_sites(id) ON DELETE SET NULL;

-- Fast lookup of a campaign's photos (used by the campaign detail page's
-- new Photos tab).
CREATE INDEX idx_site_photos_campaign
  ON site_photos(campaign_id)
  WHERE campaign_id IS NOT NULL;

-- Same for campaign_site (grouping on the campaign page).
CREATE INDEX idx_site_photos_campaign_site
  ON site_photos(campaign_site_id)
  WHERE campaign_site_id IS NOT NULL;

COMMIT;
