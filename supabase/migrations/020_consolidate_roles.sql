-- Migration 020: Consolidate sales_manager + operations_manager into a single
-- "executive" role, and add multi-role support via profiles.roles (TEXT[]).
--
-- Why:
--   The builder has decided sales and operations responsibilities should live
--   under one umbrella role ("executive"). Additionally, a user may be both
--   an executive AND the accountant — so we need multi-role support, but ONLY
--   for the {executive, accounts} pair. All other roles remain single-select.
--
-- Approach:
--   * Keep the existing `role` column as the PRIMARY role — it's referenced by
--     many RLS policies and serialised into `Profile.role` across the app.
--   * Add a `roles TEXT[]` column that stores the full set of roles assigned.
--     For users with only one role, `roles = ARRAY[role]`. For users with the
--     executive+accountant combo, `roles = ARRAY['executive','accounts']`.
--   * Application code + UI enforces that multi-select is only valid for the
--     executive+accounts pair; the DB also gates this via a CHECK constraint.
--
-- Safety:
--   * Everything in a transaction.
--   * Re-running is safe — the UPDATE statements are idempotent.

BEGIN;

-- ── 1. Add the new `roles` column ───────────────────────────────────────────
-- Default to an empty array; we'll populate it below from `role`.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS roles TEXT[] NOT NULL DEFAULT ARRAY['viewer'];


-- ── 2. Drop the old role CHECK so we can migrate data ───────────────────────
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;


-- ── 3. Migrate existing data ─────────────────────────────────────────────────
-- Any user whose single role is sales_manager or operations_manager becomes
-- an executive. All other roles stay the same.
UPDATE profiles
SET role = 'executive'
WHERE role IN ('sales_manager', 'operations_manager');

-- Populate `roles` from the (now-updated) `role` column. Running this on every
-- row is safe because it just mirrors the primary role into the array.
UPDATE profiles
SET roles = ARRAY[role];


-- ── 4. Re-add the role CHECK with the new allowed values ────────────────────
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check CHECK (
    role IN ('super_admin', 'executive', 'accounts', 'admin', 'viewer')
  );


-- ── 5. Constrain `roles` to the same vocabulary + allowed combos ────────────
-- Rules:
--   * Every element must be in the allowed set
--   * Array must be non-empty
--   * Only two combos are allowed: a single role, OR exactly
--     {executive, accounts}. Any other multi-role combo is rejected.
ALTER TABLE profiles
  ADD CONSTRAINT profiles_roles_check CHECK (
    array_length(roles, 1) BETWEEN 1 AND 2
    AND roles <@ ARRAY['super_admin','executive','accounts','admin','viewer']::TEXT[]
    AND (
      array_length(roles, 1) = 1
      OR (
        array_length(roles, 1) = 2
        AND 'executive' = ANY(roles)
        AND 'accounts'  = ANY(roles)
      )
    )
  );


-- ── 6. Keep `role` and `roles` in sync via a trigger ────────────────────────
-- Whenever `role` changes and `roles` wasn't explicitly updated alongside,
-- mirror the single role into the array so the two columns can't drift.
CREATE OR REPLACE FUNCTION sync_profile_roles()
RETURNS TRIGGER AS $$
BEGIN
  -- If the caller only updated `role`, reset `roles` to match.
  -- If the caller updated `roles`, honour that and copy the first element
  -- back into `role` as the primary.
  IF NEW.roles IS DISTINCT FROM OLD.roles THEN
    -- Caller changed roles[]: primary role becomes roles[1]
    NEW.role := NEW.roles[1];
  ELSIF NEW.role IS DISTINCT FROM OLD.role THEN
    -- Caller changed single role: mirror it to roles[]
    NEW.roles := ARRAY[NEW.role];
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_sync_roles ON profiles;
CREATE TRIGGER trg_profiles_sync_roles
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION sync_profile_roles();


-- ── 7. Update alerts' pre-existing rows that referenced the old roles ───────
-- Alerts targeting sales_manager / operations_manager should now target
-- executive. Safe to run even if no such rows exist.
UPDATE alerts
SET target_role = 'executive'
WHERE target_role IN ('sales_manager', 'operations_manager');

UPDATE alert_preferences
SET role = 'executive'
WHERE role IN ('sales_manager', 'operations_manager');


-- ── 8. Replace the campaign_change_requests RLS policy ──────────────────────
-- Migration 015 created a policy that allowed super_admin/admin/sales_manager
-- to update change requests. Now that sales_manager is gone, swap in
-- executive. Drop-and-recreate is the simplest form here.
DROP POLICY IF EXISTS "Admins can update change requests" ON campaign_change_requests;

CREATE POLICY "Admins can update change requests"
  ON campaign_change_requests FOR UPDATE
  USING (
    organization_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('super_admin', 'admin', 'executive')
  );


COMMIT;
