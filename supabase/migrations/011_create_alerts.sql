-- ─── Sprint 7: Alerts & Notification System ──────────────────────────────────
-- Two tables:
--   alerts            — individual alert records shown to users
--   alert_preferences — per-user/role config (which channels, how far in advance)
--
-- Cron job (Vercel) calls /api/cron/generate-alerts daily to INSERT new alerts.
-- RLS ensures each user only sees alerts for their org + their user_id or role.

-- ─── 1. ALERTS ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alerts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Who sees this alert?
  -- Either a specific user (user_id) OR all users with a given role (target_role).
  -- If both are set, the specific user takes precedence.
  user_id             UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  target_role         TEXT,   -- e.g. 'accounts', 'admin', 'sales_manager'

  -- What kind of alert is it?
  alert_type          TEXT NOT NULL CHECK (alert_type IN (
    'payment_due',        -- landowner / agency rent coming up
    'payment_overdue',    -- client invoice past due date
    'contract_renewal',   -- contract approaching expiry
    'campaign_ending',    -- live campaign end date approaching
    'site_available',     -- site just became free
    'municipal_expiry',   -- municipal permission expiring
    'invoice_overdue',    -- synonym for payment_overdue (client-side)
    'mounting_scheduled'  -- campaign site mounting tomorrow
  )),

  title               TEXT NOT NULL,
  message             TEXT NOT NULL,

  -- Visual styling for UI
  severity            TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),

  -- Which entity this alert is about (for click-through navigation)
  related_entity_type TEXT CHECK (related_entity_type IN ('contract', 'campaign', 'invoice', 'site', 'contract_payment')),
  related_entity_id   UUID,

  -- Read / dismissed state
  is_read             BOOLEAN NOT NULL DEFAULT FALSE,
  read_at             TIMESTAMPTZ,
  is_dismissed        BOOLEAN NOT NULL DEFAULT FALSE,

  -- When to surface this alert (lets us pre-generate future alerts)
  scheduled_for       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Date portion stored separately so we can use it in the dedup unique index
  -- (functional indexes on TIMESTAMPTZ casts are not IMMUTABLE in Postgres)
  scheduled_date      DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Email / WhatsApp send tracking
  sent_email          BOOLEAN NOT NULL DEFAULT FALSE,
  sent_whatsapp       BOOLEAN NOT NULL DEFAULT FALSE,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast unread count queries (most common UI query)
CREATE INDEX IF NOT EXISTS idx_alerts_org_user_unread
  ON alerts (organization_id, user_id, is_read, is_dismissed)
  WHERE is_dismissed = FALSE;

-- Index for role-based alerts
CREATE INDEX IF NOT EXISTS idx_alerts_org_role
  ON alerts (organization_id, target_role, is_read, is_dismissed)
  WHERE is_dismissed = FALSE;

-- Deduplication index: one alert per entity+type+day per org
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_dedup
  ON alerts (organization_id, alert_type, related_entity_id, scheduled_date)
  WHERE related_entity_id IS NOT NULL;

-- ─── 2. ALERT_PREFERENCES ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alert_preferences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Scope: either a specific user OR a role (not both)
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role            TEXT,  -- e.g. 'accounts', 'admin'

  alert_type      TEXT NOT NULL CHECK (alert_type IN (
    'payment_due', 'payment_overdue', 'contract_renewal',
    'campaign_ending', 'site_available', 'municipal_expiry',
    'invoice_overdue', 'mounting_scheduled'
  )),

  -- Channel toggles
  in_app          BOOLEAN NOT NULL DEFAULT TRUE,
  email           BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp        BOOLEAN NOT NULL DEFAULT FALSE,

  -- How many days in advance to trigger alerts (array)
  -- e.g. {90,60,30,7} means alert 90, 60, 30, and 7 days before event
  advance_days    INTEGER[] NOT NULL DEFAULT '{7,3,1}',

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One preference row per org+user/role+alert_type
CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_prefs_user_type
  ON alert_preferences (organization_id, user_id, alert_type)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_prefs_role_type
  ON alert_preferences (organization_id, role, alert_type)
  WHERE role IS NOT NULL AND user_id IS NULL;

-- Auto-update updated_at
CREATE OR REPLACE TRIGGER trg_alert_preferences_updated_at
  BEFORE UPDATE ON alert_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 3. ROW LEVEL SECURITY ────────────────────────────────────────────────────

ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_preferences ENABLE ROW LEVEL SECURITY;

-- Alerts: a user can see an alert if:
--   (a) It's for their org AND specifically assigned to them, OR
--   (b) It's for their org AND their role matches target_role
CREATE POLICY "Users can view own alerts" ON alerts
  FOR SELECT USING (
    organization_id = get_user_org_id()
    AND (
      user_id = auth.uid()
      OR target_role = (SELECT role FROM profiles WHERE id = auth.uid())
    )
  );

-- Users can update alerts assigned to them (mark read, dismiss)
CREATE POLICY "Users can update own alerts" ON alerts
  FOR UPDATE USING (
    organization_id = get_user_org_id()
    AND (
      user_id = auth.uid()
      OR target_role = (SELECT role FROM profiles WHERE id = auth.uid())
    )
  );

-- Only the service role (cron job) should insert alerts — no user INSERT policy.
-- If you want to allow admin manual alerts, add a policy here.

-- Alert preferences: users see their own preferences
CREATE POLICY "Users can view own alert preferences" ON alert_preferences
  FOR SELECT USING (
    organization_id = get_user_org_id()
    AND (
      user_id = auth.uid()
      OR role = (SELECT role FROM profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY "Users can upsert own alert preferences" ON alert_preferences
  FOR INSERT WITH CHECK (
    organization_id = get_user_org_id()
  );

CREATE POLICY "Users can update own alert preferences" ON alert_preferences
  FOR UPDATE USING (
    organization_id = get_user_org_id()
  );

-- ─── 4. SEED DEFAULT PREFERENCES ─────────────────────────────────────────────
-- These are org-level defaults (no user_id, no role) that serve as fallback.
-- In practice we insert per-role defaults at org creation time.
-- The cron job falls back to these advance_days values when no preference exists.

-- (Nothing to seed here — defaults are baked into the advance_days column DEFAULT.)
