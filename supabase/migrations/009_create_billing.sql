-- ─────────────────────────────────────────────────────────────────────────────
-- 009_create_billing.sql
-- Sprint 5: Invoices, Line Items, and Payments Received
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── invoices ────────────────────────────────────────────────────────────────

CREATE TABLE invoices (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID         NOT NULL REFERENCES organizations(id),
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by            UUID         REFERENCES auth.users(id),
  updated_by            UUID         REFERENCES auth.users(id),
  deleted_at            TIMESTAMPTZ,

  -- Unique invoice number per org, auto-generated via trigger below
  invoice_number        TEXT         NOT NULL DEFAULT '',

  -- Links
  client_id             UUID         NOT NULL REFERENCES clients(id),
  campaign_id           UUID         REFERENCES campaigns(id),

  -- Dates
  invoice_date          DATE         NOT NULL,
  due_date              DATE         NOT NULL,

  -- Financials (all in paise)
  subtotal_paise        BIGINT       NOT NULL DEFAULT 0,
  cgst_paise            BIGINT       NOT NULL DEFAULT 0,
  sgst_paise            BIGINT       NOT NULL DEFAULT 0,
  igst_paise            BIGINT       NOT NULL DEFAULT 0,
  total_paise           BIGINT       NOT NULL DEFAULT 0,
  amount_paid_paise     BIGINT       NOT NULL DEFAULT 0,
  balance_due_paise     BIGINT       NOT NULL DEFAULT 0,

  -- GST fields
  supplier_gstin        TEXT,
  buyer_gstin           TEXT,
  place_of_supply_state TEXT,
  is_inter_state        BOOLEAN      NOT NULL DEFAULT false,
  sac_code              TEXT         NOT NULL DEFAULT '998361',

  -- Status
  status                TEXT         NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled')),

  -- Content
  notes                 TEXT,
  terms_and_conditions  TEXT,
  pdf_url               TEXT,

  CONSTRAINT invoices_number_org_unique UNIQUE (organization_id, invoice_number)
);

-- Auto-generate invoice number: INV-YYYYMM-NNNN
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
DECLARE
  v_ym   TEXT;
  v_seq  INT;
BEGIN
  v_ym := TO_CHAR(NEW.invoice_date, 'YYYYMM');

  SELECT COALESCE(
    MAX(NULLIF(
      REGEXP_REPLACE(invoice_number, '^INV-' || v_ym || '-0*', ''),
      ''
    )::INT),
    0
  ) + 1
  INTO v_seq
  FROM invoices
  WHERE organization_id = NEW.organization_id
    AND invoice_number LIKE 'INV-' || v_ym || '-%';

  NEW.invoice_number := 'INV-' || v_ym || '-' || LPAD(v_seq::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_invoice_number
  BEFORE INSERT ON invoices
  FOR EACH ROW
  WHEN (NEW.invoice_number IS NULL OR NEW.invoice_number = '')
  EXECUTE FUNCTION generate_invoice_number();

CREATE TRIGGER update_invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_select_invoices" ON invoices FOR SELECT USING (organization_id = get_user_org_id());
CREATE POLICY "org_insert_invoices" ON invoices FOR INSERT WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY "org_update_invoices" ON invoices FOR UPDATE USING (organization_id = get_user_org_id());

-- Indexes
CREATE INDEX ON invoices (organization_id, status);
CREATE INDEX ON invoices (organization_id, client_id);
CREATE INDEX ON invoices (organization_id, due_date);
CREATE INDEX ON invoices (organization_id, invoice_date DESC);

-- ─── invoice_line_items ───────────────────────────────────────────────────────

CREATE TABLE invoice_line_items (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID         NOT NULL REFERENCES organizations(id),
  invoice_id      UUID         NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

  site_id         UUID         REFERENCES sites(id),
  service_type    TEXT         NOT NULL DEFAULT 'display_rental'
                  CHECK (service_type IN ('display_rental', 'flex_printing', 'mounting', 'design', 'transport', 'other')),
  description     TEXT         NOT NULL,
  hsn_sac_code    TEXT         NOT NULL DEFAULT '998361',

  quantity        DECIMAL(10,2) NOT NULL DEFAULT 1,
  rate_paise      BIGINT       NOT NULL,
  amount_paise    BIGINT       NOT NULL,  -- quantity × rate_paise

  period_from     DATE,
  period_to       DATE
);

-- RLS
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_select_line_items"  ON invoice_line_items FOR SELECT USING (organization_id = get_user_org_id());
CREATE POLICY "org_insert_line_items"  ON invoice_line_items FOR INSERT WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY "org_update_line_items"  ON invoice_line_items FOR UPDATE USING (organization_id = get_user_org_id());
CREATE POLICY "org_delete_line_items"  ON invoice_line_items FOR DELETE USING (organization_id = get_user_org_id());

-- Indexes
CREATE INDEX ON invoice_line_items (invoice_id);
CREATE INDEX ON invoice_line_items (organization_id, site_id);

-- ─── payments_received ────────────────────────────────────────────────────────

CREATE TABLE payments_received (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID        REFERENCES auth.users(id),

  invoice_id       UUID        NOT NULL REFERENCES invoices(id),
  client_id        UUID        NOT NULL REFERENCES clients(id),

  amount_paise     BIGINT      NOT NULL,
  payment_date     DATE        NOT NULL,
  payment_mode     TEXT        NOT NULL DEFAULT 'bank_transfer'
                   CHECK (payment_mode IN ('cash', 'cheque', 'bank_transfer', 'upi', 'online')),
  reference_number TEXT,
  bank_name        TEXT,
  notes            TEXT,
  receipt_number   TEXT
);

-- RLS
ALTER TABLE payments_received ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_select_payments_received" ON payments_received FOR SELECT USING (organization_id = get_user_org_id());
CREATE POLICY "org_insert_payments_received" ON payments_received FOR INSERT WITH CHECK (organization_id = get_user_org_id());

-- Indexes
CREATE INDEX ON payments_received (invoice_id);
CREATE INDEX ON payments_received (organization_id, client_id);
CREATE INDEX ON payments_received (organization_id, payment_date DESC);
