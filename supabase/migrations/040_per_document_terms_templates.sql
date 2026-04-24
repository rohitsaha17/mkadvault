-- Migration 040 — per-document T&C templates on organizations.
--
-- Supersedes migration 026's single `proposal_terms_template` with four
-- scoped columns so each document type can carry its own default terms:
--
--   invoice_terms_template         → pre-fills /billing/invoices/new
--   rate_card_terms_template       → pre-fills the proposal / rate-card wizard
--   payment_voucher_terms_template → pre-fills the payment-request PDF
--   receipt_voucher_terms_template → pre-fills the receipt voucher (when that PDF is built)
--
-- All nullable, all TEXT, defaulted to NULL so existing tenants aren't
-- forced to fill any of them. The settings UI shows one textarea per
-- document in an accordion; writes are tolerant of the old
-- `proposal_terms_template` column being absent.
--
-- Idempotent: uses IF NOT EXISTS. Safe to re-run.

BEGIN;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS invoice_terms_template         TEXT,
  ADD COLUMN IF NOT EXISTS rate_card_terms_template       TEXT,
  ADD COLUMN IF NOT EXISTS payment_voucher_terms_template TEXT,
  ADD COLUMN IF NOT EXISTS receipt_voucher_terms_template TEXT;

-- If migration 026 was applied earlier, copy whatever rate-card T&C the
-- org had into the new rate_card_terms_template column so the settings
-- page feels continuous. No-op when 026 never ran (the IF check
-- short-circuits through the information_schema lookup).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organizations'
      AND column_name = 'proposal_terms_template'
  ) THEN
    EXECUTE $sql$
      UPDATE organizations
         SET rate_card_terms_template =
               COALESCE(rate_card_terms_template, proposal_terms_template)
       WHERE proposal_terms_template IS NOT NULL
    $sql$;
  END IF;
END $$;

COMMENT ON COLUMN organizations.invoice_terms_template IS
  'Default T&C text pre-filled on invoices (/billing/invoices/new).';
COMMENT ON COLUMN organizations.rate_card_terms_template IS
  'Default T&C text pre-filled on proposals and rate cards.';
COMMENT ON COLUMN organizations.payment_voucher_terms_template IS
  'Default T&C text pre-filled on the payment-request PDF.';
COMMENT ON COLUMN organizations.receipt_voucher_terms_template IS
  'Default T&C text pre-filled on the receipt voucher PDF (future).';

COMMIT;
