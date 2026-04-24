-- Migration 037 — generic soft-delete RPC
--
-- Migration 036 fixed this for `campaigns` via soft_delete_campaign.
-- Turns out every table with a SELECT policy that filters
-- `deleted_at IS NULL` has the same bug: setting deleted_at via
-- UPDATE from the authenticated role triggers the RETURNING +
-- SELECT policy check, which fails because the updated row is no
-- longer SELECT-visible. Users see
--    new row violates row-level security policy for table "<t>"
-- ...for every soft-delete. The bug surfaced again on site_expenses
-- (payment requests) and applies to 8+ tables.
--
-- Rather than writing a dedicated RPC for each table, one generic
-- soft_delete_row(table, id) RPC bypasses RLS for the UPDATE while
-- enforcing org-match in SQL. The calling Server Action already
-- validates role + row-level preconditions through the authenticated
-- client BEFORE the RPC call — the RPC is strictly the "escape
-- hatch" for the RETURNING-vs-SELECT-policy interaction.

BEGIN;

CREATE OR REPLACE FUNCTION public.soft_delete_row(
  p_table text,
  p_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_org uuid;
  v_row_org uuid;
  v_allowed text[] := ARRAY[
    'site_expenses',
    'clients',
    'landowners',
    'partner_agencies',
    'contracts',
    'sites',
    'invoices',
    'proposals',
    'signed_agreements',
    'organization_bank_accounts',
    'campaign_jobs'
  ];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Table whitelist. We only soft-delete business tables with the
  -- (organization_id, deleted_at) pair — never arbitrary tables.
  IF NOT (p_table = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'Soft-delete not allowed on table %', p_table
      USING ERRCODE = '42501';
  END IF;

  SELECT org_id INTO v_user_org FROM profiles WHERE id = v_user_id;
  IF v_user_org IS NULL THEN
    RAISE EXCEPTION 'Caller has no organisation' USING ERRCODE = '42501';
  END IF;

  -- Look up the target row's org so we can fail-fast on cross-org
  -- attempts. format() is used with %I to quote the table identifier
  -- safely even though it's from our whitelist.
  EXECUTE format('SELECT organization_id FROM public.%I WHERE id = $1', p_table)
    INTO v_row_org USING p_id;

  IF v_row_org IS NULL THEN
    RAISE EXCEPTION 'Row % not found in %', p_id, p_table
      USING ERRCODE = 'P0002';
  END IF;

  IF v_row_org <> v_user_org THEN
    RAISE EXCEPTION 'Cross-organisation soft-delete blocked'
      USING ERRCODE = '42501';
  END IF;

  -- The actual soft-delete. SECURITY DEFINER means RLS doesn't fire
  -- here, so the SELECT-policy + RETURNING interaction that plagued
  -- direct authenticated UPDATEs is bypassed.
  EXECUTE format('UPDATE public.%I SET deleted_at = now() WHERE id = $1', p_table)
    USING p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.soft_delete_row(text, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.soft_delete_row(text, uuid) FROM anon;

COMMIT;
