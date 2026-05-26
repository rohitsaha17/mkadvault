-- Migration 043 — extend the notifications schema for P0 events
-- ─────────────────────────────────────────────────────────────────
-- Layers two changes on top of migration 011:
--
-- 1. Add the new alert_type values P0 needs to write (invoice_paid,
--    expense_approved, expense_rejected, expense_paid,
--    campaign_starting, cron_failure). The original CHECK list was
--    drafted before the payment-request and renewal flows existed,
--    so it doesn't cover those.
--
-- 2. Add `notification_scope` on profiles. The builder asked for the
--    "executives see all org events vs only their own" toggle to be
--    a per-user setting that defaults to "org" today and can move
--    to "own" once the org grows. Storing it on profiles keeps
--    things simple — one column, easy to query in the dispatcher.
--
-- All idempotent; safe to re-run.

BEGIN;

-- ─── 1. Widen alert_type CHECK on `alerts` ────────────────────────────────
-- Postgres doesn't let us "add a value to a CHECK list" — we drop the
-- existing constraint and re-add it with the merged list. Same shape
-- as 011 plus the new P0 types.
ALTER TABLE alerts
  DROP CONSTRAINT IF EXISTS alerts_alert_type_check;

ALTER TABLE alerts
  ADD CONSTRAINT alerts_alert_type_check CHECK (alert_type IN (
    -- Originals from 011
    'payment_due',
    'payment_overdue',
    'contract_renewal',
    'campaign_ending',
    'site_available',
    'municipal_expiry',
    'invoice_overdue',
    'mounting_scheduled',
    -- P0 additions (notifications plan)
    'invoice_sent',        -- finance team — an invoice just went out
    'invoice_paid',        -- finance team — a payment came in
    'expense_approved',    -- requester — their payment request was approved
    'expense_rejected',    -- requester — their payment request was rejected
    'expense_paid',        -- requester — their request has now been paid
    'campaign_starting',   -- today's the start_date for a campaign
    'campaign_completed',  -- auto-flipped by the cron when end passes
    'campaign_cancelled',  -- manual cancellation
    'cron_failure'         -- admin self-care
  ));

-- Same widening on alert_preferences so users can opt in/out of the
-- new event types from the settings page.
ALTER TABLE alert_preferences
  DROP CONSTRAINT IF EXISTS alert_preferences_alert_type_check;

ALTER TABLE alert_preferences
  ADD CONSTRAINT alert_preferences_alert_type_check CHECK (alert_type IN (
    'payment_due',
    'payment_overdue',
    'contract_renewal',
    'campaign_ending',
    'site_available',
    'municipal_expiry',
    'invoice_overdue',
    'mounting_scheduled',
    'invoice_sent',
    'invoice_paid',
    'expense_approved',
    'expense_rejected',
    'expense_paid',
    'campaign_starting',
    'campaign_completed',
    'campaign_cancelled',
    'cron_failure'
  ));

-- ─── 2. Widen related_entity_type so we can link expense alerts ──────────
ALTER TABLE alerts
  DROP CONSTRAINT IF EXISTS alerts_related_entity_type_check;

ALTER TABLE alerts
  ADD CONSTRAINT alerts_related_entity_type_check CHECK (
    related_entity_type IS NULL OR related_entity_type IN (
      'contract', 'campaign', 'invoice', 'site', 'contract_payment',
      'expense'        -- site_expenses / payment requests
    )
  );

-- ─── 3. Per-user notification scope on profiles ──────────────────────────
-- Drives whether the executive role sees notifications for the whole
-- org's campaigns + sites ("org") or only the ones where they're the
-- created_by / updated_by ("own"). Default "org" matches the
-- builder's "for now everyone gets everything" stance; the settings
-- UI will expose a toggle to switch.
--
-- Admin / accounts / manager always see org-wide regardless of this
-- setting — the column is consulted by the dispatcher only for the
-- executive role.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notification_scope TEXT
    NOT NULL DEFAULT 'org'
    CHECK (notification_scope IN ('org', 'own'));

COMMENT ON COLUMN profiles.notification_scope IS
  'Executive-only knob: org = receive notifications for everything in the org (default), own = only events where this user is the created_by/owner.';

COMMIT;
