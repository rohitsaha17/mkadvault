-- ─── 006_create_contracts.sql ────────────────────────────────────────────────
-- Contracts, amendments, and the payment schedule for each contract.
--
-- Design notes:
-- • rent_amount_paise / amount_due_paise: bigint in paise (1 INR = 100 paise).
--   Marked "ENCRYPT IN PRODUCTION" — same plan as landowner bank fields.
-- • contract_type drives which FK must be non-null (landowner vs agency).
-- • contract_payments holds both scheduled (upcoming) and recorded (paid) rows
--   — one row per instalment. Auto-generated on contract creation.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── contracts ────────────────────────────────────────────────────────────────

CREATE TABLE contracts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID        REFERENCES auth.users(id),
  updated_by      UUID        REFERENCES auth.users(id),
  deleted_at      TIMESTAMPTZ,

  -- Which party type is this contract with?
  contract_type   TEXT        NOT NULL CHECK (contract_type IN ('landowner', 'agency')),

  -- Exactly one of these must be set (enforced via CHECK below)
  landowner_id    UUID        REFERENCES landowners(id),
  agency_id       UUID        REFERENCES partner_agencies(id),

  -- Which site does this contract cover?
  site_id         UUID        NOT NULL REFERENCES sites(id),

  -- Payment structure
  payment_model   TEXT        NOT NULL
    CHECK (payment_model IN ('monthly_fixed', 'yearly_lumpsum', 'revenue_share', 'custom')),

  -- For monthly_fixed and revenue_share minimum guarantee — ENCRYPT IN PRODUCTION
  rent_amount_paise         BIGINT,
  payment_day_of_month      INTEGER CHECK (payment_day_of_month BETWEEN 1 AND 28),
  -- For yearly_lumpsum
  payment_date              DATE,
  -- For revenue_share
  revenue_share_percentage  NUMERIC(5, 2),
  minimum_guarantee_paise   BIGINT,
  -- Escalation
  escalation_percentage         NUMERIC(5, 2),
  escalation_frequency_months   INTEGER DEFAULT 12,

  -- Term
  start_date              DATE        NOT NULL,
  end_date                DATE,
  renewal_date            DATE,
  notice_period_days      INTEGER     NOT NULL DEFAULT 90,
  lock_period_months      INTEGER,
  early_termination_clause TEXT,

  -- Status
  status          TEXT        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'terminated', 'pending_renewal')),

  -- Uploaded scan (path in "contracts" Storage bucket)
  contract_document_url   TEXT,

  notes           TEXT,

  -- Party constraint: the correct FK must match the contract type
  CONSTRAINT contracts_party_check CHECK (
    (contract_type = 'landowner' AND landowner_id IS NOT NULL AND agency_id IS NULL) OR
    (contract_type = 'agency'    AND agency_id    IS NOT NULL AND landowner_id IS NULL)
  )
);

CREATE TRIGGER set_contracts_updated_at
  BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_contracts_org ON contracts (organization_id);
CREATE INDEX idx_contracts_status ON contracts (organization_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_contracts_site ON contracts (site_id);
CREATE INDEX idx_contracts_type ON contracts (organization_id, contract_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_contracts_expiry ON contracts (organization_id, end_date) WHERE deleted_at IS NULL;

-- ─── contract_amendments ──────────────────────────────────────────────────────

CREATE TABLE contract_amendments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id     UUID        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID        REFERENCES auth.users(id),

  amendment_date  DATE        NOT NULL DEFAULT CURRENT_DATE,
  description     TEXT        NOT NULL,
  old_terms       JSONB,
  new_terms       JSONB,
  document_url    TEXT
);

CREATE INDEX idx_contract_amendments_contract
  ON contract_amendments (contract_id);

-- ─── contract_payments ────────────────────────────────────────────────────────

CREATE TABLE contract_payments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id     UUID        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID        REFERENCES auth.users(id),
  updated_by      UUID        REFERENCES auth.users(id),

  due_date        DATE        NOT NULL,

  -- ENCRYPT IN PRODUCTION
  amount_due_paise    BIGINT  NOT NULL,
  amount_paid_paise   BIGINT,

  payment_date        DATE,
  payment_mode        TEXT CHECK (payment_mode IN ('cash', 'cheque', 'bank_transfer', 'upi', 'online')),
  payment_reference   TEXT,

  tds_deducted_paise  BIGINT,
  tds_percentage      NUMERIC(5, 2),

  status          TEXT        NOT NULL DEFAULT 'upcoming'
    CHECK (status IN ('upcoming', 'due', 'paid', 'overdue', 'partially_paid')),

  notes           TEXT
);

CREATE TRIGGER set_contract_payments_updated_at
  BEFORE UPDATE ON contract_payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_contract_payments_contract ON contract_payments (contract_id);
CREATE INDEX idx_contract_payments_org_status ON contract_payments (organization_id, status);
CREATE INDEX idx_contract_payments_due_date ON contract_payments (organization_id, due_date);

-- ─── RLS — contracts ──────────────────────────────────────────────────────────

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org contracts" ON contracts
  FOR SELECT USING (organization_id = get_user_org_id() AND deleted_at IS NULL);

CREATE POLICY "Users can insert own org contracts" ON contracts
  FOR INSERT WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY "Users can update own org contracts" ON contracts
  FOR UPDATE USING (organization_id = get_user_org_id());

CREATE POLICY "Admins can delete own org contracts" ON contracts
  FOR DELETE USING (
    organization_id = get_user_org_id()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('super_admin', 'admin')
  );

-- ─── RLS — contract_amendments ────────────────────────────────────────────────

ALTER TABLE contract_amendments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org amendments" ON contract_amendments
  FOR SELECT USING (organization_id = get_user_org_id());

CREATE POLICY "Users can insert own org amendments" ON contract_amendments
  FOR INSERT WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY "Users can update own org amendments" ON contract_amendments
  FOR UPDATE USING (organization_id = get_user_org_id());

-- ─── RLS — contract_payments ──────────────────────────────────────────────────

ALTER TABLE contract_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org payments" ON contract_payments
  FOR SELECT USING (organization_id = get_user_org_id());

CREATE POLICY "Users can insert own org payments" ON contract_payments
  FOR INSERT WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY "Users can update own org payments" ON contract_payments
  FOR UPDATE USING (organization_id = get_user_org_id());
