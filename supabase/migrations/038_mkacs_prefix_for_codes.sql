-- Migration 038 — prepend MKACS- to every auto-generated code.
--
-- The platform's three sequential identifiers now look like:
--   campaign_code:  MKACS-CAM-YYYYMM-NNN
--   invoice_number: MKACS-INV-YYYYMM-NNNN
--   receipt_number: MKACS-RCP-YYYYMM-NNNN   (server-generated in
--                   billing/actions.ts — no trigger)
--
-- Existing rows KEEP their old codes. Only new inserts from here on
-- pick up the MKACS- prefix. The per-org+month counter scope is
-- unchanged, so the sequential suffix continues from wherever the
-- old code left off (the LIKE match is updated accordingly so the
-- counter keeps incrementing across the prefix switch).

BEGIN;

-- ─── campaigns.campaign_code ────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_campaign_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_prefix TEXT;
  v_seq    INTEGER;
BEGIN
  v_prefix := 'MKACS-CAM-' || to_char(now(), 'YYYYMM');

  -- Count against the full new-prefix AND the legacy CAM- prefix for
  -- the same month so the counter keeps moving monotonically when
  -- we cross the prefix boundary mid-month.
  SELECT COALESCE(MAX(
    (regexp_match(campaign_code, '-(\d+)$'))[1]::INTEGER
  ), 0) + 1
  INTO v_seq
  FROM campaigns
  WHERE organization_id = NEW.organization_id
    AND (
      campaign_code LIKE v_prefix || '-%'
      OR campaign_code LIKE 'CAM-' || to_char(now(), 'YYYYMM') || '-%'
    );

  NEW.campaign_code := v_prefix || '-' || lpad(v_seq::TEXT, 3, '0');
  RETURN NEW;
END;
$$;

-- ─── invoices.invoice_number ────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
DECLARE
  v_ym   TEXT;
  v_seq  INT;
BEGIN
  v_ym := TO_CHAR(NEW.invoice_date, 'YYYYMM');

  -- Strip whichever prefix is present (legacy INV- or new MKACS-INV-)
  -- so the counter lookup sees a plain integer either way.
  SELECT COALESCE(
    MAX(NULLIF(
      REGEXP_REPLACE(
        invoice_number,
        '^(MKACS-)?INV-' || v_ym || '-0*',
        ''
      ),
      ''
    )::INT),
    0
  ) + 1
  INTO v_seq
  FROM invoices
  WHERE organization_id = NEW.organization_id
    AND (
      invoice_number LIKE 'MKACS-INV-' || v_ym || '-%'
      OR invoice_number LIKE 'INV-' || v_ym || '-%'
    );

  NEW.invoice_number := 'MKACS-INV-' || v_ym || '-' || LPAD(v_seq::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
