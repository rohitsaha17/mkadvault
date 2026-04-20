-- Extend the allowed action values in campaign_activity_log
-- to support change request workflow and service-related actions.

-- Drop the existing constraint and recreate with extended values
ALTER TABLE campaign_activity_log DROP CONSTRAINT IF EXISTS campaign_activity_log_action_check;
ALTER TABLE campaign_activity_log
  ADD CONSTRAINT campaign_activity_log_action_check
  CHECK (action IN (
    'status_changed', 'note_added', 'file_uploaded', 'payment_received',
    'site_added', 'site_removed', 'created', 'updated',
    'change_requested', 'change_approved', 'change_rejected',
    'service_added', 'service_removed'
  ));
