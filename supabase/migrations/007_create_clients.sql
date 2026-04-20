-- ─── 007_create_clients.sql ──────────────────────────────────────────────────
-- Clients table — brands and companies that book advertising campaigns with us.
-- Tracks all contact roles (primary, secondary, billing) and payment terms.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE clients (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by              UUID        REFERENCES auth.users(id),
  updated_by              UUID        REFERENCES auth.users(id),
  deleted_at              TIMESTAMPTZ,

  -- Company identity
  company_name            TEXT        NOT NULL,
  brand_name              TEXT,
  industry_category       TEXT,
  client_type             TEXT        NOT NULL DEFAULT 'direct_client'
    CHECK (client_type IN ('direct_client', 'agency', 'government')),

  -- Primary contact (the main person we deal with)
  primary_contact_name    TEXT,
  primary_contact_phone   TEXT,
  primary_contact_email   TEXT,

  -- Secondary contact (backup / alternate contact)
  secondary_contact_name  TEXT,
  secondary_contact_phone TEXT,
  secondary_contact_email TEXT,

  -- Billing contact (may differ from primary — finance dept etc.)
  billing_contact_name    TEXT,
  billing_contact_phone   TEXT,
  billing_contact_email   TEXT,

  -- GST / tax
  gstin                   TEXT,
  pan                     TEXT,

  -- Billing address
  billing_address         TEXT,
  billing_city            TEXT,
  billing_state           TEXT,
  billing_pin_code        TEXT,

  -- Payment terms (how long after invoice before payment is expected)
  credit_terms            TEXT        NOT NULL DEFAULT 'advance'
    CHECK (credit_terms IN ('advance', 'net15', 'net30', 'net60')),

  notes                   TEXT
);

-- Auto-update updated_at on every write
CREATE TRIGGER set_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_select" ON clients FOR SELECT
  USING (organization_id = get_user_org_id() AND deleted_at IS NULL);

CREATE POLICY "clients_insert" ON clients FOR INSERT
  WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY "clients_update" ON clients FOR UPDATE
  USING (organization_id = get_user_org_id());

CREATE POLICY "clients_delete" ON clients FOR DELETE
  USING (
    organization_id = get_user_org_id()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('super_admin', 'admin')
  );

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX idx_clients_org ON clients(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_clients_company ON clients(organization_id, company_name) WHERE deleted_at IS NULL;
CREATE INDEX idx_clients_type ON clients(organization_id, client_type) WHERE deleted_at IS NULL;
