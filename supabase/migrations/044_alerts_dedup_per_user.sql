-- Widen the alerts dedup index to per-user.
--
-- Migration 011 created a dedup unique index on
--   (organization_id, alert_type, related_entity_id, scheduled_date)
-- That worked for the legacy "broadcast to target_role" model where one
-- row served everyone with a given role.
--
-- The new dispatcher (lib/notifications/dispatch.ts) writes ONE row per
-- recipient so each user can mark their own copy as read. With the old
-- index, only the first row landed and every other recipient lost their
-- in-app alert. This migration replaces the index so user_id is part of
-- the conflict key, keeping the cron-retry dedup behaviour AND letting
-- multiple users coexist on the same event.

BEGIN;

-- Drop the old broadcast-style dedup index.
DROP INDEX IF EXISTS idx_alerts_dedup;

-- New per-user dedup. user_id NULL still falls under the partial
-- predicate so role-broadcast inserts (legacy generators) keep working
-- — for those rows we treat NULL as a sentinel "no specific user".
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_dedup_per_user
  ON alerts (organization_id, alert_type, related_entity_id, scheduled_date, user_id)
  WHERE related_entity_id IS NOT NULL;

COMMIT;
