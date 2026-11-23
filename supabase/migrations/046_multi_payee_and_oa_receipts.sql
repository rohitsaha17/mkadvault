-- Migration 046 — multi-payee sites, split rent payments, on-account
-- client receipts, Tally bill number, and partner-agency link on rented
-- sites.
--
-- Shipped as one migration so there's a single SQL block to paste into
-- the dashboard for people who can't `supabase db push`.
--
-- Backward-compatible / additive only:
--   * Nothing is renamed or dropped.
--   * sites.landowner_id stays (acts as the "primary / only payee" when
--     no site_payees rows exist).
--   * All RLS mirrors the existing org_id pattern.
--
-- Covers:
--   1. sites.partner_agency_id + relaxed constraint so rented sites can
--      directly reference the agency they're sublet from.
--   2. site_payees — many-to-many between sites and
--      (landowner|agency) with a percentage share of rent. Must sum to
--      100 per site when rows exist.
--   3. contract_payment_site_allocations — splits one rent payment
--      across multiple sites (one row per site slice).
--   4. client_receipts + client_receipt_allocations — record a
--      receipt from a client without an invoice attached and allocate
--      to one or more invoices later.
--   5. invoices.external_invoice_number — Tally bill number
--      cross-reference.

-- ─── 1. sites.partner_agency_id ──────────────────────────────────────────────
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS partner_agency_id UUID REFERENCES public.partner_agencies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sites_partner_agency
  ON public.sites (partner_agency_id)
  WHERE partner_agency_id IS NOT NULL;

-- Rented sites may carry an agency; owned sites may carry a landowner;
-- a site never has both at once. The landowner-only-if-owned check from
-- 013 stays as is; we just add the mirror for agency-only-if-rented.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sites_agency_only_if_rented'
  ) THEN
    ALTER TABLE public.sites
      ADD CONSTRAINT sites_agency_only_if_rented
      CHECK (partner_agency_id IS NULL OR ownership_model = 'rented');
  END IF;
END$$;

-- ─── 2. site_payees ──────────────────────────────────────────────────────────
-- Multi-payee per site, each with a percentage share. When any row
-- exists for a site, ignore sites.landowner_id and use this table.
-- When empty, fall back to sites.landowner_id as the single payee.
CREATE TABLE IF NOT EXISTS public.site_payees (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id          UUID        NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID        REFERENCES auth.users(id),

  payee_type       TEXT        NOT NULL CHECK (payee_type IN ('landowner', 'agency')),
  landowner_id     UUID        REFERENCES public.landowners(id) ON DELETE RESTRICT,
  agency_id        UUID        REFERENCES public.partner_agencies(id) ON DELETE RESTRICT,

  -- share of rent as a percentage 0.01–100.00. Stored as NUMERIC so
  -- splits like 33.33 / 33.33 / 33.34 round-trip cleanly.
  share_percent    NUMERIC(6,3) NOT NULL CHECK (share_percent > 0 AND share_percent <= 100),

  -- Optional label for this payee row (e.g. "father's share", "society
  -- maintenance") — surfaces in rent-allocation UI.
  label            TEXT,

  notes            TEXT,

  -- Exactly one FK set, matching payee_type.
  CONSTRAINT site_payees_counterparty_matches_type
    CHECK (
      (payee_type = 'landowner' AND landowner_id IS NOT NULL AND agency_id IS NULL) OR
      (payee_type = 'agency'    AND agency_id IS NOT NULL AND landowner_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_site_payees_site
  ON public.site_payees (site_id);
CREATE INDEX IF NOT EXISTS idx_site_payees_org
  ON public.site_payees (organization_id);
CREATE INDEX IF NOT EXISTS idx_site_payees_landowner
  ON public.site_payees (landowner_id) WHERE landowner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_site_payees_agency
  ON public.site_payees (agency_id) WHERE agency_id IS NOT NULL;

ALTER TABLE public.site_payees ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='org_select_site_payees' AND tablename='site_payees') THEN
    CREATE POLICY "org_select_site_payees" ON public.site_payees
      FOR SELECT USING (organization_id = get_user_org_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='org_insert_site_payees' AND tablename='site_payees') THEN
    CREATE POLICY "org_insert_site_payees" ON public.site_payees
      FOR INSERT WITH CHECK (organization_id = get_user_org_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='org_update_site_payees' AND tablename='site_payees') THEN
    CREATE POLICY "org_update_site_payees" ON public.site_payees
      FOR UPDATE USING (organization_id = get_user_org_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='org_delete_site_payees' AND tablename='site_payees') THEN
    CREATE POLICY "org_delete_site_payees" ON public.site_payees
      FOR DELETE USING (organization_id = get_user_org_id());
  END IF;
END$$;

CREATE TRIGGER set_site_payees_updated_at
  BEFORE UPDATE ON public.site_payees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Helper: shares sum to 100 for each site. Enforced as a deferred
-- constraint-style check via a trigger rather than a CHECK because the
-- sum spans multiple rows.
CREATE OR REPLACE FUNCTION site_payees_sum_to_100()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_site UUID;
  v_sum  NUMERIC(10,3);
BEGIN
  v_site := COALESCE(NEW.site_id, OLD.site_id);
  SELECT COALESCE(SUM(share_percent), 0) INTO v_sum
    FROM public.site_payees WHERE site_id = v_site;
  -- Zero rows (after a delete) is fine — site falls back to single-payee mode.
  IF v_sum = 0 THEN RETURN NEW; END IF;
  IF ABS(v_sum - 100) > 0.001 THEN
    RAISE EXCEPTION 'Site payee shares for site % must sum to 100%% (got %)', v_site, v_sum;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_payees_sum_check ON public.site_payees;
CREATE CONSTRAINT TRIGGER site_payees_sum_check
  AFTER INSERT OR UPDATE OR DELETE ON public.site_payees
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION site_payees_sum_to_100();

-- ─── 3. contract_payment_site_allocations ────────────────────────────────────
-- One contract_payment can cover multiple sites. Each allocation row
-- carries the paise slice for one site. A row optionally also names
-- which payee that slice goes to (so multi-payee sites can break the
-- slice down further for accounting).
CREATE TABLE IF NOT EXISTS public.contract_payment_site_allocations (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_payment_id  UUID        NOT NULL REFERENCES public.contract_payments(id) ON DELETE CASCADE,
  site_id              UUID        NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
  site_payee_id        UUID        REFERENCES public.site_payees(id) ON DELETE SET NULL,
  amount_paise         BIGINT      NOT NULL CHECK (amount_paise > 0),
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           UUID        REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_cp_site_alloc_payment
  ON public.contract_payment_site_allocations (contract_payment_id);
CREATE INDEX IF NOT EXISTS idx_cp_site_alloc_site
  ON public.contract_payment_site_allocations (site_id);
CREATE INDEX IF NOT EXISTS idx_cp_site_alloc_org
  ON public.contract_payment_site_allocations (organization_id);

ALTER TABLE public.contract_payment_site_allocations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='org_select_cp_site_alloc' AND tablename='contract_payment_site_allocations') THEN
    CREATE POLICY "org_select_cp_site_alloc" ON public.contract_payment_site_allocations
      FOR SELECT USING (organization_id = get_user_org_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='org_insert_cp_site_alloc' AND tablename='contract_payment_site_allocations') THEN
    CREATE POLICY "org_insert_cp_site_alloc" ON public.contract_payment_site_allocations
      FOR INSERT WITH CHECK (organization_id = get_user_org_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='org_update_cp_site_alloc' AND tablename='contract_payment_site_allocations') THEN
    CREATE POLICY "org_update_cp_site_alloc" ON public.contract_payment_site_allocations
      FOR UPDATE USING (organization_id = get_user_org_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='org_delete_cp_site_alloc' AND tablename='contract_payment_site_allocations') THEN
    CREATE POLICY "org_delete_cp_site_alloc" ON public.contract_payment_site_allocations
      FOR DELETE USING (organization_id = get_user_org_id());
  END IF;
END$$;

-- ─── 4. client_receipts + client_receipt_allocations ─────────────────────────
-- A top-level receipt from a client, decoupled from any specific
-- invoice. Allocations link it to invoices as reconciliation happens.
-- The "on-account" balance for a client = sum(client_receipts.amount) −
-- sum(client_receipt_allocations.amount) for rows still unallocated.
CREATE TABLE IF NOT EXISTS public.client_receipts (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id           UUID        NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,

  receipt_number      TEXT,
  receipt_date        DATE        NOT NULL,
  amount_paise        BIGINT      NOT NULL CHECK (amount_paise > 0),
  payment_mode        TEXT        NOT NULL DEFAULT 'bank_transfer'
                      CHECK (payment_mode IN ('cash', 'cheque', 'bank_transfer', 'upi', 'online')),
  reference_number    TEXT,
  bank_name           TEXT,
  tds_paise           BIGINT      NOT NULL DEFAULT 0 CHECK (tds_paise >= 0),

  -- Tally / external accounting reference so the finance team can match
  -- a receipt in the app to the voucher number in their books.
  external_reference  TEXT,

  notes               TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID        REFERENCES auth.users(id),
  updated_by          UUID        REFERENCES auth.users(id),
  deleted_at          TIMESTAMPTZ
);

CREATE TRIGGER set_client_receipts_updated_at
  BEFORE UPDATE ON public.client_receipts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_client_receipts_client
  ON public.client_receipts (client_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_client_receipts_org_date
  ON public.client_receipts (organization_id, receipt_date DESC) WHERE deleted_at IS NULL;

ALTER TABLE public.client_receipts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='org_select_client_receipts' AND tablename='client_receipts') THEN
    CREATE POLICY "org_select_client_receipts" ON public.client_receipts
      FOR SELECT USING (organization_id = get_user_org_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='org_insert_client_receipts' AND tablename='client_receipts') THEN
    CREATE POLICY "org_insert_client_receipts" ON public.client_receipts
      FOR INSERT WITH CHECK (organization_id = get_user_org_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='org_update_client_receipts' AND tablename='client_receipts') THEN
    CREATE POLICY "org_update_client_receipts" ON public.client_receipts
      FOR UPDATE USING (organization_id = get_user_org_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='org_delete_client_receipts' AND tablename='client_receipts') THEN
    CREATE POLICY "org_delete_client_receipts" ON public.client_receipts
      FOR DELETE USING (organization_id = get_user_org_id());
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS public.client_receipt_allocations (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_receipt_id    UUID        NOT NULL REFERENCES public.client_receipts(id) ON DELETE CASCADE,
  invoice_id           UUID        NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  amount_paise         BIGINT      NOT NULL CHECK (amount_paise > 0),
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           UUID        REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_client_receipt_alloc_receipt
  ON public.client_receipt_allocations (client_receipt_id);
CREATE INDEX IF NOT EXISTS idx_client_receipt_alloc_invoice
  ON public.client_receipt_allocations (invoice_id);
CREATE INDEX IF NOT EXISTS idx_client_receipt_alloc_org
  ON public.client_receipt_allocations (organization_id);

ALTER TABLE public.client_receipt_allocations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='org_select_cr_alloc' AND tablename='client_receipt_allocations') THEN
    CREATE POLICY "org_select_cr_alloc" ON public.client_receipt_allocations
      FOR SELECT USING (organization_id = get_user_org_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='org_insert_cr_alloc' AND tablename='client_receipt_allocations') THEN
    CREATE POLICY "org_insert_cr_alloc" ON public.client_receipt_allocations
      FOR INSERT WITH CHECK (organization_id = get_user_org_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='org_update_cr_alloc' AND tablename='client_receipt_allocations') THEN
    CREATE POLICY "org_update_cr_alloc" ON public.client_receipt_allocations
      FOR UPDATE USING (organization_id = get_user_org_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='org_delete_cr_alloc' AND tablename='client_receipt_allocations') THEN
    CREATE POLICY "org_delete_cr_alloc" ON public.client_receipt_allocations
      FOR DELETE USING (organization_id = get_user_org_id());
  END IF;
END$$;

-- ─── 5. invoices.external_invoice_number ─────────────────────────────────────
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS external_invoice_number TEXT;

CREATE INDEX IF NOT EXISTS idx_invoices_external_number
  ON public.invoices (organization_id, external_invoice_number)
  WHERE external_invoice_number IS NOT NULL AND deleted_at IS NULL;

-- ─── 6. Keep the planner happy ───────────────────────────────────────────────
ANALYZE public.sites;
ANALYZE public.invoices;
