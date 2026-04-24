-- Migration 036 — SECURITY DEFINER RPCs for soft-deleting records.
--
-- Why: our SELECT RLS policies filter out rows where deleted_at IS
-- NOT NULL (so the app's list queries don't have to repeat that
-- filter). Postgres applies the SELECT policy to the RETURNING rows
-- of an UPDATE, and PostgREST always generates a RETURNING clause.
-- The net effect is that a plain `UPDATE ... SET deleted_at = now()`
-- from the authenticated role ALWAYS fails with:
--
--     new row violates row-level security policy for table "<t>"
--
-- ...because the updated row no longer satisfies the SELECT policy.
-- This is a well-known Postgres footgun when RLS doubles as a
-- "hide-soft-deleted" filter.
--
-- Fix: wrap the soft-delete in a SECURITY DEFINER function. The
-- function runs as the table owner and therefore bypasses RLS for
-- its own UPDATE, while we re-implement the authorisation check in
-- SQL (org match + role) so the caller can't delete anything they
-- shouldn't. The app calls this via `supabase.rpc('soft_delete_<x>', ...)`.

BEGIN;

-- Helper: returns the caller's (org_id, role). Stable so it can be
-- called multiple times cheaply inside a function.
CREATE OR REPLACE FUNCTION public.caller_profile()
RETURNS TABLE (org_id uuid, role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.org_id, p.role
  FROM profiles p
  WHERE p.id = auth.uid()
  LIMIT 1;
$$;

-- ─── soft_delete_campaign ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.soft_delete_campaign(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_org uuid;
  v_user_role text;
  v_camp_org uuid;
  v_camp_name text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT org_id, role INTO v_user_org, v_user_role FROM caller_profile();

  IF v_user_role NOT IN ('super_admin', 'admin', 'manager') THEN
    RAISE EXCEPTION 'Only admins or managers can delete campaigns'
      USING ERRCODE = '42501';
  END IF;

  SELECT organization_id, campaign_name
    INTO v_camp_org, v_camp_name
    FROM campaigns
   WHERE id = p_id AND deleted_at IS NULL;

  IF v_camp_org IS NULL THEN
    RAISE EXCEPTION 'Campaign not found or already deleted'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_camp_org <> v_user_org THEN
    RAISE EXCEPTION 'Cross-organisation access blocked'
      USING ERRCODE = '42501';
  END IF;

  UPDATE campaigns
     SET deleted_at = now(), updated_by = v_user_id
   WHERE id = p_id;

  -- Audit trail — same insert the old server action did, but safe
  -- from here since we've already verified the caller.
  INSERT INTO campaign_activity_log (
    organization_id, campaign_id, user_id,
    action, description
  ) VALUES (
    v_camp_org, p_id, v_user_id,
    'deleted',
    CASE
      WHEN v_camp_name IS NOT NULL THEN format('Campaign "%s" deleted', v_camp_name)
      ELSE 'Campaign deleted'
    END
  );
END;
$$;

-- Grant execution to the authenticated role. anon has no business here.
GRANT EXECUTE ON FUNCTION public.soft_delete_campaign(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.soft_delete_campaign(uuid) FROM anon;

COMMIT;
