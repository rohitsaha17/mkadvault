-- Migration 001: Organizations table
-- This is the tenant table. Phase 1 = one row (our agency).
-- Phase 2 = one row per agency on the marketplace.

-- ============================================================
-- HELPER: updated_at trigger function (reused by all tables)
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- ORGANIZATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  gstin       TEXT,
  pan         TEXT,
  address     TEXT,
  city        TEXT,
  state       TEXT,
  pin_code    TEXT,
  phone       TEXT,
  email       TEXT,
  logo_url    TEXT,
  -- org-level configuration: invoice format, GST rates, reminder days, etc.
  settings    JSONB NOT NULL DEFAULT '{}',
  -- subscription tier (used in Phase 2 marketplace)
  subscription_tier TEXT NOT NULL DEFAULT 'free'
    CHECK (subscription_tier IN ('free', 'starter', 'pro', 'enterprise')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update updated_at on every row change
CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- NOTE: The actual SELECT and UPDATE policies reference the `profiles` table,
-- which doesn't exist yet at this point in the migration order.
-- They are created in migration 002 after `profiles` is set up.
-- INSERT is handled via the service-role admin client (setup flow / triggers).
-- DELETE is intentionally disabled (organizations are never deleted).
