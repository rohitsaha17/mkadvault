-- Migration 019: Allow users to read their own profile even without an org.
-- This is needed for the onboarding flow where a newly registered user
-- has no org_id yet. Without this, RLS blocks them from reading their
-- own profile row (because NULL = NULL is false in SQL).

-- Allow users to always SELECT their own profile row
CREATE POLICY "user_can_select_own_profile"
  ON profiles FOR SELECT
  USING (id = auth.uid());
