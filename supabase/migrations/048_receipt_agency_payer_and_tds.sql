-- Migration 048 — agency as a payer on receipts, and TDS on
-- invoice-linked receipts.
--
-- Fixes the Nov 2026 "Record Payment on an agency-billed invoice
-- fails with 'null value in column client_id ... violates not-null
-- constraint'" bug.
--
-- Backward-compatible / additive:
--   * nothing dropped, nothing renamed;
--   * payments_received.client_id becomes nullable so an agency can
--     be the payer, enforced via a CHECK that still requires exactly
--     one of client_id / agency_id to be set;
--   * client_receipts gets the same shape so on-account receipts can
--     be recorded for an agency as well;
--   * payments_received.tds_paise added, default 0 — the Record
--     Payment dialog surfaces a "TDS deducted" field and the invoice
--     balance now = total − sum(amount_paise + tds_paise).
--
-- RLS: untouched. Both tables already gate SELECT/INSERT/UPDATE/DELETE
-- on organization_id = get_user_org_id() (009 + 012 for
-- payments_received, 046 for client_receipts). The new columns don't
-- change that boundary.

-- ─── 1. payments_received — agency payer + TDS ───────────────────────────────

-- Make client_id nullable so an agency-billed receipt can be inserted.
ALTER TABLE public.payments_received
  ALTER COLUMN client_id DROP NOT NULL;

-- Agency payer. Mirrors invoices.billed_agency_id from migration 047:
-- when the parent invoice is billed to an agency, the receipt's payer
-- is that agency and client_id stays NULL.
ALTER TABLE public.payments_received
  ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES public.partner_agencies(id);

CREATE INDEX IF NOT EXISTS idx_payments_received_agency
  ON public.payments_received (organization_id, agency_id)
  WHERE agency_id IS NOT NULL;

-- Exactly one of client_id / agency_id must be set per row. Using
-- NUM_NONNULLS so the intent reads clearly; the two-column CHECK keeps
-- the invariant close to the data.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_received_payer_xor'
  ) THEN
    ALTER TABLE public.payments_received
      ADD CONSTRAINT payments_received_payer_xor
      CHECK (num_nonnulls(client_id, agency_id) = 1);
  END IF;
END$$;

-- TDS deducted by the payer against this receipt. Combined with the
-- cash amount it reduces the invoice balance so the invoice can settle
-- without the full cash figure ever arriving.
ALTER TABLE public.payments_received
  ADD COLUMN IF NOT EXISTS tds_paise BIGINT NOT NULL DEFAULT 0
  CHECK (tds_paise >= 0);

-- ─── 2. client_receipts — agency payer ───────────────────────────────────────
-- On-account receipts for an agency. tds_paise already exists (046).

ALTER TABLE public.client_receipts
  ALTER COLUMN client_id DROP NOT NULL;

ALTER TABLE public.client_receipts
  ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES public.partner_agencies(id);

CREATE INDEX IF NOT EXISTS idx_client_receipts_agency
  ON public.client_receipts (organization_id, agency_id)
  WHERE agency_id IS NOT NULL AND deleted_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_receipts_payer_xor'
  ) THEN
    ALTER TABLE public.client_receipts
      ADD CONSTRAINT client_receipts_payer_xor
      CHECK (num_nonnulls(client_id, agency_id) = 1);
  END IF;
END$$;

-- ─── 3. Keep the planner happy ───────────────────────────────────────────────
ANALYZE public.payments_received;
ANALYZE public.client_receipts;
