-- ─── 005_create_partner_agencies.sql ─────────────────────────────────────────
-- Partner agencies — external OOH agencies we trade/exchange sites with.
-- In Phase 2 these may also be other tenants on the marketplace.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE partner_agencies (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID        REFERENCES auth.users(id),
  updated_by      UUID        REFERENCES auth.users(id),
  deleted_at      TIMESTAMPTZ,

  agency_name     TEXT        NOT NULL,
  contact_person  TEXT,
  phone           TEXT,
  email           TEXT,
  gstin           TEXT,

  address         TEXT,
  city            TEXT,
  state           TEXT,

  notes           TEXT
);

CREATE TRIGGER set_partner_agencies_updated_at
  BEFORE UPDATE ON partner_agencies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_partner_agencies_org_active
  ON partner_agencies (organization_id, deleted_at NULLS FIRST);

CREATE INDEX idx_partner_agencies_org_city
  ON partner_agencies (organization_id, city)
  WHERE deleted_at IS NULL;

-- RLS
ALTER TABLE partner_agencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org agencies" ON partner_agencies
  FOR SELECT USING (organization_id = get_user_org_id() AND deleted_at IS NULL);

CREATE POLICY "Users can insert own org agencies" ON partner_agencies
  FOR INSERT WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY "Users can update own org agencies" ON partner_agencies
  FOR UPDATE USING (organization_id = get_user_org_id());

CREATE POLICY "Admins can delete own org agencies" ON partner_agencies
  FOR DELETE USING (
    organization_id = get_user_org_id()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('super_admin', 'admin')
  );
