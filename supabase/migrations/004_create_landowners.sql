-- ─── 004_create_landowners.sql ───────────────────────────────────────────────
-- Landowner table — stores people/entities who own the land/structures that
-- we lease for our advertising sites.
--
-- Sensitive fields (PAN, Aadhaar, bank details) are marked with
-- "-- ENCRYPT IN PRODUCTION" comments. Once pgcrypto / Supabase Vault is set
-- up, wrap these with pgp_sym_encrypt(value, org_key) on write and
-- pgp_sym_decrypt(value::bytea, org_key) on read.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE landowners (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID        REFERENCES auth.users(id),
  updated_by      UUID        REFERENCES auth.users(id),
  deleted_at      TIMESTAMPTZ,

  -- Personal info
  full_name       TEXT        NOT NULL,
  phone           TEXT,
  phone_alt       TEXT,
  email           TEXT,

  -- Address
  address         TEXT,
  city            TEXT,
  state           TEXT,
  pin_code        TEXT,

  -- Tax identifiers — ENCRYPT IN PRODUCTION
  pan_number      TEXT,
  aadhaar_reference TEXT,

  -- Bank details — ENCRYPT IN PRODUCTION
  bank_name            TEXT,
  bank_account_number  TEXT,
  bank_ifsc            TEXT,

  notes           TEXT
);

CREATE TRIGGER set_landowners_updated_at
  BEFORE UPDATE ON landowners
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes
CREATE INDEX idx_landowners_org_active
  ON landowners (organization_id, deleted_at NULLS FIRST);

CREATE INDEX idx_landowners_org_city
  ON landowners (organization_id, city)
  WHERE deleted_at IS NULL;

-- RLS
ALTER TABLE landowners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org landowners" ON landowners
  FOR SELECT USING (organization_id = get_user_org_id() AND deleted_at IS NULL);

CREATE POLICY "Users can insert own org landowners" ON landowners
  FOR INSERT WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY "Users can update own org landowners" ON landowners
  FOR UPDATE USING (organization_id = get_user_org_id());

CREATE POLICY "Admins can delete own org landowners" ON landowners
  FOR DELETE USING (
    organization_id = get_user_org_id()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('super_admin', 'admin')
  );
