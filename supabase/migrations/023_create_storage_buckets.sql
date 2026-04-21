-- Migration 023: Create the Supabase Storage buckets the app relies on,
-- plus the RLS policies that keep each org's files isolated from others.
--
-- Buckets (per CLAUDE.md):
--   site-photos  — photos of OOH inventory
--   contracts    — scanned landowner/agency contracts
--   invoices     — generated invoice PDFs
--   creatives    — client-supplied campaign creative files
--   proposals    — exported proposals (PDF/PPTX)
--
-- All buckets are PRIVATE — access goes through signed URLs or the
-- authenticated client. Object paths start with {org_id}/... so we can
-- enforce per-org isolation via a storage.objects policy.
--
-- Idempotent: uses ON CONFLICT DO NOTHING so re-running is safe.

BEGIN;

-- ─── Buckets ──────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('site-photos', 'site-photos', false),
  ('contracts',   'contracts',   false),
  ('invoices',    'invoices',    false),
  ('creatives',   'creatives',   false),
  ('proposals',   'proposals',   false)
ON CONFLICT (id) DO NOTHING;

-- ─── Policies on storage.objects ──────────────────────────────────────────────
-- Objects must live under "{org_id}/..." — we use the first path segment as
-- the tenant id. A user can read/write only in their own org's folder.

-- Helper: owner org_id for the current user
-- (inlined into each policy so we don't need a separate function migration)

DO $$
BEGIN
  -- SELECT (read) policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'app_buckets_read_own_org'
  ) THEN
    CREATE POLICY app_buckets_read_own_org ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id IN ('site-photos','contracts','invoices','creatives','proposals')
        AND (storage.foldername(name))[1] = (
          SELECT org_id::text FROM public.profiles WHERE id = auth.uid()
        )
      );
  END IF;

  -- INSERT (upload) policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'app_buckets_insert_own_org'
  ) THEN
    CREATE POLICY app_buckets_insert_own_org ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id IN ('site-photos','contracts','invoices','creatives','proposals')
        AND (storage.foldername(name))[1] = (
          SELECT org_id::text FROM public.profiles WHERE id = auth.uid()
        )
      );
  END IF;

  -- UPDATE policy (e.g. replacing a file)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'app_buckets_update_own_org'
  ) THEN
    CREATE POLICY app_buckets_update_own_org ON storage.objects
      FOR UPDATE TO authenticated
      USING (
        bucket_id IN ('site-photos','contracts','invoices','creatives','proposals')
        AND (storage.foldername(name))[1] = (
          SELECT org_id::text FROM public.profiles WHERE id = auth.uid()
        )
      );
  END IF;

  -- DELETE policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'app_buckets_delete_own_org'
  ) THEN
    CREATE POLICY app_buckets_delete_own_org ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id IN ('site-photos','contracts','invoices','creatives','proposals')
        AND (storage.foldername(name))[1] = (
          SELECT org_id::text FROM public.profiles WHERE id = auth.uid()
        )
      );
  END IF;
END $$;

COMMIT;
