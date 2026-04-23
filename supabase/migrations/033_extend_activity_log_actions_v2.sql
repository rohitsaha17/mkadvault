-- Extend campaign_activity_log.action once more to cover job-related
-- events (migration 030 added campaign_jobs) and soft-deletes, so the
-- Activity tab can show a complete per-campaign audit trail.
--
-- Previous state (migration 017):
--   created, updated, status_changed, note_added, file_uploaded,
--   payment_received, site_added, site_removed,
--   change_requested, change_approved, change_rejected,
--   service_added, service_removed
-- New actions: job_added, job_updated, job_removed,
--              service_updated, deleted

BEGIN;

ALTER TABLE campaign_activity_log
  DROP CONSTRAINT IF EXISTS campaign_activity_log_action_check;

ALTER TABLE campaign_activity_log
  ADD CONSTRAINT campaign_activity_log_action_check
  CHECK (action IN (
    'created', 'updated', 'deleted',
    'status_changed', 'note_added', 'file_uploaded', 'payment_received',
    'site_added', 'site_removed',
    'service_added', 'service_removed', 'service_updated',
    'job_added', 'job_updated', 'job_removed',
    'change_requested', 'change_approved', 'change_rejected'
  ));

COMMIT;
