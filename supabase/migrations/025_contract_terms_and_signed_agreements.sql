-- ─── 025_contract_terms_and_signed_agreements.sql ───────────────────────────
-- Extensions to the contracts module:
--
--  1. `contracts.terms_clauses` (jsonb) — a list of free-form terms &
--     conditions clauses ({ title, content }) attached to the contract.
--     Kept as JSONB so we don't need a second table for what is effectively
--     a small, ordered list of paragraphs that always load with the contract.
--
--  2. `contracts.signed_document_url` (text) — separate from
--     `contract_document_url` (which holds the drafted/template scan). This
--     column stores the path to the counter-signed copy once both parties
--     have executed the agreement.
--
--  3. `signed_agreements` table — a lightweight bucket for uploading scanned
--     signed agreements that aren't yet tied to a full contract record. Use
--     cases: older paper contracts, one-off MoUs, NDAs, miscellaneous signed
--     documents the team wants centralised.
--
-- Idempotent: safe to re-run.

BEGIN;

-- 1. contracts.terms_clauses -------------------------------------------------
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS terms_clauses jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2. contracts.signed_document_url -------------------------------------------
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS signed_document_url text;

-- 3. signed_agreements table -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.signed_agreements (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        REFERENCES auth.users(id),
  updated_by      uuid        REFERENCES auth.users(id),
  deleted_at      timestamptz,

  -- Free-text description of what this agreement is
  title           text        NOT NULL,

  -- Optional links to help find it later. All nullable — a standalone
  -- agreement may not relate to any specific party or site.
  counterparty_type text      CHECK (counterparty_type IN ('landowner','agency','client','other')),
  landowner_id    uuid        REFERENCES public.landowners(id) ON DELETE SET NULL,
  agency_id       uuid        REFERENCES public.partner_agencies(id) ON DELETE SET NULL,
  client_id       uuid        REFERENCES public.clients(id) ON DELETE SET NULL,
  site_id         uuid        REFERENCES public.sites(id) ON DELETE SET NULL,

  agreement_date  date,

  -- The uploaded scan. Path in the "contracts" Storage bucket:
  --   {org_id}/signed-agreements/{uuid}.{ext}
  document_url    text        NOT NULL,

  notes           text
);

CREATE INDEX IF NOT EXISTS idx_signed_agreements_org
  ON public.signed_agreements (organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_signed_agreements_landowner
  ON public.signed_agreements (landowner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_signed_agreements_agency
  ON public.signed_agreements (agency_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_signed_agreements_client
  ON public.signed_agreements (client_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_signed_agreements_site
  ON public.signed_agreements (site_id) WHERE deleted_at IS NULL;

-- updated_at trigger (function is defined in 001_init)
DROP TRIGGER IF EXISTS set_signed_agreements_updated_at ON public.signed_agreements;
CREATE TRIGGER set_signed_agreements_updated_at
  BEFORE UPDATE ON public.signed_agreements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS ------------------------------------------------------------------------
ALTER TABLE public.signed_agreements ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='signed_agreements'
      AND policyname='Users can view own org signed agreements'
  ) THEN
    CREATE POLICY "Users can view own org signed agreements" ON public.signed_agreements
      FOR SELECT USING (organization_id = get_user_org_id() AND deleted_at IS NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='signed_agreements'
      AND policyname='Users can insert own org signed agreements'
  ) THEN
    CREATE POLICY "Users can insert own org signed agreements" ON public.signed_agreements
      FOR INSERT WITH CHECK (organization_id = get_user_org_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='signed_agreements'
      AND policyname='Users can update own org signed agreements'
  ) THEN
    CREATE POLICY "Users can update own org signed agreements" ON public.signed_agreements
      FOR UPDATE USING (organization_id = get_user_org_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='signed_agreements'
      AND policyname='Admins can delete own org signed agreements'
  ) THEN
    CREATE POLICY "Admins can delete own org signed agreements" ON public.signed_agreements
      FOR DELETE USING (
        organization_id = get_user_org_id()
        AND (SELECT role FROM public.profiles WHERE id = auth.uid())
            IN ('super_admin','admin')
      );
  END IF;
END $$;

COMMIT;
