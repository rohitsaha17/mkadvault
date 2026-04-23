-- Migration 032 — organization_bank_accounts
-- Stores one or more bank accounts per organization. The user picks
-- which bank account to print on each invoice when creating it, so
-- different clients / campaigns can be billed into different accounts
-- (e.g. INR current account vs. a project-specific escrow).
--
-- Also adds invoices.bank_account_id so each invoice remembers the
-- account it was issued against — this way the PDF re-renders
-- consistently even if the account list changes later.
--
-- RLS: org isolation via get_user_org_id() (defined in migration 002).

BEGIN;

CREATE TABLE public.organization_bank_accounts (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by          UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by          UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at          TIMESTAMPTZ,

  -- Friendly label shown in invoice dropdown (e.g. "HDFC Current — Main").
  -- Falls back to bank_name if unset.
  label               TEXT,

  -- Bank details printed on the invoice.
  bank_name           TEXT         NOT NULL,
  account_holder_name TEXT,
  account_number      TEXT         NOT NULL,
  ifsc_code           TEXT         NOT NULL,
  branch_name         TEXT,
  account_type        TEXT         CHECK (account_type IN ('savings', 'current', 'other')),
  upi_id              TEXT,
  swift_code          TEXT,

  -- UX flags.
  is_primary          BOOLEAN      NOT NULL DEFAULT false,
  is_active           BOOLEAN      NOT NULL DEFAULT true,

  notes               TEXT
);

-- At most one primary per org. Soft-deleted rows are excluded from the
-- uniqueness check so re-adding a primary after removing one works.
CREATE UNIQUE INDEX idx_org_bank_accounts_one_primary
  ON organization_bank_accounts(organization_id)
  WHERE is_primary = true AND deleted_at IS NULL;

CREATE INDEX idx_org_bank_accounts_org
  ON organization_bank_accounts(organization_id) WHERE deleted_at IS NULL;

-- updated_at auto-maintain
DROP TRIGGER IF EXISTS set_updated_at_org_bank_accounts ON public.organization_bank_accounts;
CREATE TRIGGER set_updated_at_org_bank_accounts
  BEFORE UPDATE ON public.organization_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE public.organization_bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_can_select_bank_accounts"
  ON organization_bank_accounts FOR SELECT
  USING (organization_id = get_user_org_id() AND deleted_at IS NULL);

-- Only admins manage bank details (sensitive).
CREATE POLICY "org_admins_can_insert_bank_accounts"
  ON organization_bank_accounts FOR INSERT
  WITH CHECK (
    organization_id = get_user_org_id()
    AND (SELECT role FROM profiles WHERE id = auth.uid())
        IN ('super_admin', 'admin')
  );

CREATE POLICY "org_admins_can_update_bank_accounts"
  ON organization_bank_accounts FOR UPDATE
  USING (
    organization_id = get_user_org_id()
    AND (SELECT role FROM profiles WHERE id = auth.uid())
        IN ('super_admin', 'admin')
  );

CREATE POLICY "org_admins_can_delete_bank_accounts"
  ON organization_bank_accounts FOR DELETE
  USING (
    organization_id = get_user_org_id()
    AND (SELECT role FROM profiles WHERE id = auth.uid())
        IN ('super_admin', 'admin')
  );

-- Link chosen bank account to invoice.
-- ON DELETE SET NULL so deleting a bank account doesn't cascade-kill
-- invoices; the historical PDF already has the details inlined and
-- the invoice detail page can gracefully show "not set" if needed.
ALTER TABLE public.invoices
  ADD COLUMN bank_account_id UUID
    REFERENCES organization_bank_accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_invoices_bank_account
  ON invoices(bank_account_id) WHERE bank_account_id IS NOT NULL;

COMMIT;
