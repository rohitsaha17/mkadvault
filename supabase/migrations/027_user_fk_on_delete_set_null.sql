-- 027_user_fk_on_delete_set_null.sql
--
-- Purpose: allow deleting a team member (auth.users row) without being
-- blocked by created_by / updated_by foreign keys across business tables.
--
-- Previously these FKs were declared inline as
--   created_by UUID REFERENCES auth.users(id)
-- which defaults to ON DELETE NO ACTION. When an admin tried to delete a
-- deactivated user who had ever created / updated a site / campaign /
-- invoice / anything, the delete failed with a FK violation and the
-- toast showed an opaque Postgres error.
--
-- Fix: switch every ownership FK (`created_by`, `updated_by`,
-- `requested_by`, `reviewed_by`) referencing auth.users to
--   ON DELETE SET NULL
-- so the business record survives, just with "unknown creator".
--
-- `campaign_change_requests.requested_by` was NOT NULL — we relax it to
-- nullable so SET NULL can succeed.
--
-- `profiles.id` and `alerts.user_id` / `notifications.user_id` already
-- have ON DELETE CASCADE and are left alone.

-- ── Helper: rewrite the FK on one (table, column) pair ──────────────────────
-- Drops whatever constraint currently covers the column and re-adds it with
-- ON DELETE SET NULL. Uses information_schema so we don't hard-code FK names
-- (Postgres default names, e.g. sites_created_by_fkey, can differ if the
-- table was recreated under a different naming scheme).
CREATE OR REPLACE FUNCTION _set_fk_on_delete_set_null(
  p_table text,
  p_column text,
  p_ref_table text,
  p_ref_schema text DEFAULT 'auth'
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_constraint text;
BEGIN
  SELECT tc.constraint_name
    INTO v_constraint
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema    = kcu.table_schema
   AND tc.table_name      = kcu.table_name
  WHERE tc.table_schema   = 'public'
    AND tc.table_name     = p_table
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name   = p_column
  LIMIT 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', p_table, v_constraint);
  END IF;

  EXECUTE format(
    'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I.%I(id) ON DELETE SET NULL',
    p_table,
    p_table || '_' || p_column || '_fkey',
    p_column,
    p_ref_schema,
    p_ref_table
  );
END;
$$;

-- ── Apply to every ownership FK referencing auth.users ──────────────────────
-- sites
SELECT _set_fk_on_delete_set_null('sites',                    'created_by',   'users');
SELECT _set_fk_on_delete_set_null('sites',                    'updated_by',   'users');
SELECT _set_fk_on_delete_set_null('site_photos',              'created_by',   'users');

-- landowners / partner agencies
SELECT _set_fk_on_delete_set_null('landowners',               'created_by',   'users');
SELECT _set_fk_on_delete_set_null('landowners',               'updated_by',   'users');
SELECT _set_fk_on_delete_set_null('partner_agencies',         'created_by',   'users');
SELECT _set_fk_on_delete_set_null('partner_agencies',         'updated_by',   'users');

-- contracts family
SELECT _set_fk_on_delete_set_null('contracts',                'created_by',   'users');
SELECT _set_fk_on_delete_set_null('contracts',                'updated_by',   'users');
SELECT _set_fk_on_delete_set_null('contract_amendments',      'created_by',   'users');
SELECT _set_fk_on_delete_set_null('contract_payments',        'created_by',   'users');
SELECT _set_fk_on_delete_set_null('contract_payments',        'updated_by',   'users');
SELECT _set_fk_on_delete_set_null('signed_agreements',        'created_by',   'users');
SELECT _set_fk_on_delete_set_null('signed_agreements',        'updated_by',   'users');

-- clients / campaigns / proposals
SELECT _set_fk_on_delete_set_null('clients',                  'created_by',   'users');
SELECT _set_fk_on_delete_set_null('clients',                  'updated_by',   'users');
SELECT _set_fk_on_delete_set_null('campaigns',                'created_by',   'users');
SELECT _set_fk_on_delete_set_null('campaigns',                'updated_by',   'users');
SELECT _set_fk_on_delete_set_null('proposals',                'created_by',   'users');
SELECT _set_fk_on_delete_set_null('proposals',                'updated_by',   'users');

-- billing
SELECT _set_fk_on_delete_set_null('invoices',                 'created_by',   'users');
SELECT _set_fk_on_delete_set_null('invoices',                 'updated_by',   'users');
SELECT _set_fk_on_delete_set_null('payments_received',        'created_by',   'users');

-- campaign change requests — requested_by was NOT NULL, relax to nullable so
-- SET NULL can actually succeed.
ALTER TABLE IF EXISTS public.campaign_change_requests
  ALTER COLUMN requested_by DROP NOT NULL;

SELECT _set_fk_on_delete_set_null('campaign_change_requests', 'requested_by', 'users');
SELECT _set_fk_on_delete_set_null('campaign_change_requests', 'reviewed_by',  'users');

-- ── Cleanup: helper function no longer needed ───────────────────────────────
DROP FUNCTION _set_fk_on_delete_set_null(text, text, text, text);
