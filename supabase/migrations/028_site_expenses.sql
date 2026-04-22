-- 028_site_expenses.sql
--
-- Site expenses / payment requests.
--
-- Any user can raise a payment request linked to a site — "electricity bill
-- for site MUM-001", "monthly rent due to landowner X", "cleaning crew
-- invoice", etc. The request records who is to be paid and how much.
--
-- The accounts / finance team reviews and marks it paid, attaching a proof
-- (UPI screenshot, bank transfer receipt, NEFT advice, signed cash voucher).
-- We keep the raw bill scan too so the paper trail is self-contained.
--
-- Multi-tenant isolation via organization_id + the existing get_user_org_id()
-- helper from migration 002. Follows the same RLS pattern as landowners etc.

BEGIN;

-- ── Table ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.site_expenses (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- The site the expense relates to. Nullable so an org can still log an
  -- overhead that isn't tied to one specific site (office rent, software).
  site_id         UUID        REFERENCES sites(id) ON DELETE SET NULL,

  -- What the money is for.
  category        TEXT        NOT NULL CHECK (category IN (
                                  'electricity',
                                  'rent',
                                  'maintenance',
                                  'cleaning',
                                  'light_change',
                                  'repair',
                                  'permit_fee',
                                  'printing',
                                  'mounting',
                                  'fuel_transport',
                                  'other'
                                )),
  description     TEXT        NOT NULL,
  amount_paise    BIGINT      NOT NULL CHECK (amount_paise >= 0),

  -- Who gets paid. payee_type decides how payee_id is interpreted.
  payee_type      TEXT        NOT NULL CHECK (payee_type IN (
                                  'landowner',
                                  'agency',
                                  'vendor',
                                  'contractor',
                                  'employee',
                                  'other'
                                )),
  payee_id        UUID,       -- optional FK — landowner or partner_agency id
  payee_name      TEXT        NOT NULL,
  payee_contact   TEXT,       -- phone / email, free-form
  payee_bank_details JSONB,   -- optional: {bank, account_number, ifsc, upi}

  -- Lifecycle.
  status          TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','approved','paid','rejected')),

  needed_by       DATE,       -- when the requester needs this paid by

  -- Payment settlement fields (populated when accounts marks it paid).
  paid_at         TIMESTAMPTZ,
  paid_by         UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  payment_mode    TEXT        CHECK (payment_mode IN ('cash','cheque','bank_transfer','upi','online')),
  payment_reference TEXT,     -- UPI ref, cheque no, NEFT/RTGS UTR
  tds_paise       BIGINT      CHECK (tds_paise IS NULL OR tds_paise >= 0),

  -- Supporting docs. Storage paths under the "expense-docs" bucket,
  -- always prefixed {organization_id}/... for per-org isolation.
  --   receipt_doc_urls  — uploaded at request time (bill, quotation)
  --   payment_proof_urls — uploaded when marking paid (screenshot, stamped voucher)
  receipt_doc_urls    TEXT[]  NOT NULL DEFAULT ARRAY[]::TEXT[],
  payment_proof_urls  TEXT[]  NOT NULL DEFAULT ARRAY[]::TEXT[],

  notes           TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at      TIMESTAMPTZ
);

-- Sanity: paid rows must carry paid_at and payment_mode so reporting never
-- has to guess. Enforced at the DB so a partial update from the client can't
-- produce an orphan "paid" row without the supporting fields.
ALTER TABLE public.site_expenses
  ADD CONSTRAINT site_expenses_paid_fields_present
  CHECK (
    status <> 'paid'
    OR (paid_at IS NOT NULL AND payment_mode IS NOT NULL)
  );

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_site_expenses_org_status
  ON public.site_expenses (organization_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_site_expenses_site
  ON public.site_expenses (site_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_site_expenses_needed_by
  ON public.site_expenses (needed_by)
  WHERE deleted_at IS NULL AND status IN ('pending','approved');

-- ── updated_at trigger ───────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS set_updated_at_site_expenses ON public.site_expenses;
CREATE TRIGGER set_updated_at_site_expenses
  BEFORE UPDATE ON public.site_expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE public.site_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org expenses" ON public.site_expenses
  FOR SELECT USING (organization_id = get_user_org_id() AND deleted_at IS NULL);

CREATE POLICY "Users can insert own org expenses" ON public.site_expenses
  FOR INSERT WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY "Users can update own org expenses" ON public.site_expenses
  FOR UPDATE USING (organization_id = get_user_org_id());

-- Deletes are soft (set deleted_at). We still permit hard delete for admins
-- so they can remove clearly mis-keyed rows that haven't been paid yet.
CREATE POLICY "Admins can delete own org expenses" ON public.site_expenses
  FOR DELETE USING (
    organization_id = get_user_org_id()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('super_admin','admin')
  );

-- ── Storage bucket for receipts + payment proofs ─────────────────────────────
-- Separate from site-photos so photo galleries don't accidentally pick up
-- financial receipts. Private bucket, signed URLs only.
INSERT INTO storage.buckets (id, name, public)
VALUES ('expense-docs', 'expense-docs', false)
ON CONFLICT (id) DO NOTHING;

-- Per-org isolation using the {organization_id}/... path convention, same as
-- the existing buckets policy in migration 023.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'expense_docs_read_own_org'
  ) THEN
    CREATE POLICY expense_docs_read_own_org ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'expense-docs'
        AND (storage.foldername(name))[1] = (
          SELECT org_id::text FROM public.profiles WHERE id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'expense_docs_insert_own_org'
  ) THEN
    CREATE POLICY expense_docs_insert_own_org ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'expense-docs'
        AND (storage.foldername(name))[1] = (
          SELECT org_id::text FROM public.profiles WHERE id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'expense_docs_update_own_org'
  ) THEN
    CREATE POLICY expense_docs_update_own_org ON storage.objects
      FOR UPDATE TO authenticated
      USING (
        bucket_id = 'expense-docs'
        AND (storage.foldername(name))[1] = (
          SELECT org_id::text FROM public.profiles WHERE id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'expense_docs_delete_own_org'
  ) THEN
    CREATE POLICY expense_docs_delete_own_org ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id = 'expense-docs'
        AND (storage.foldername(name))[1] = (
          SELECT org_id::text FROM public.profiles WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

COMMIT;
