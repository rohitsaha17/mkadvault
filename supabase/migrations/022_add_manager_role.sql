-- Migration 022: Add the "manager" role.
--
-- Why:
--   A manager is a team member who should be able to do EVERYTHING that a
--   sales/operations executive can do AND everything an accountant can do
--   (campaigns, sites, mounting, billing, reports), but must NOT be able to
--   change org-level settings or manage other team members.
--
--   We add it as a first-class single role rather than expanding the
--   {executive, accounts} multi-role combo, because:
--     1. The constants / UI have a strict rule that only {executive,accounts}
--        is a valid multi-role pair. Adding more combos bloats the UX.
--     2. A dedicated role is easier to reason about for RLS and future
--        features that target "manager or admin" (e.g. cost visibility).
--
-- Safety:
--   * Wrapped in a transaction.
--   * Drops + recreates CHECK constraints; idempotent to re-run.

BEGIN;

-- ── 1. Widen the profiles.role CHECK to allow 'manager' ────────────────────
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check CHECK (
    role IN ('super_admin', 'manager', 'executive', 'accounts', 'admin', 'viewer')
  );

-- ── 2. Widen the profiles.roles[] CHECK to allow 'manager' ─────────────────
-- manager must be held alone — it's a single-select role, like admin.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_roles_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_roles_check CHECK (
    array_length(roles, 1) BETWEEN 1 AND 2
    AND roles <@ ARRAY['super_admin','manager','executive','accounts','admin','viewer']::TEXT[]
    AND (
      array_length(roles, 1) = 1
      OR (
        array_length(roles, 1) = 2
        AND 'executive' = ANY(roles)
        AND 'accounts'  = ANY(roles)
      )
    )
  );

-- ── 3. Extend the campaign_change_requests update policy ───────────────────
-- Managers should be able to review change requests just like executives.
DROP POLICY IF EXISTS "Admins can update change requests" ON campaign_change_requests;

CREATE POLICY "Admins can update change requests"
  ON campaign_change_requests FOR UPDATE
  USING (
    organization_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
    AND (SELECT role FROM profiles WHERE id = auth.uid())
      IN ('super_admin', 'admin', 'executive', 'manager')
  );

COMMIT;
