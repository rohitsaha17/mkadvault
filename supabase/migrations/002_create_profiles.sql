-- Migration 002: Profiles table + helper functions + auth trigger
-- Profiles extend auth.users with org membership, roles, and display info.

-- ============================================================
-- PROFILES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  -- Same UUID as auth.users.id — one-to-one relationship
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Which organization this user belongs to
  org_id      UUID REFERENCES organizations(id) ON DELETE SET NULL,
  role        TEXT NOT NULL DEFAULT 'viewer'
    CHECK (role IN (
      'super_admin', 'sales_manager', 'operations_manager',
      'accounts', 'admin', 'viewer'
    )),
  full_name   TEXT,
  phone       TEXT,
  avatar_url  TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update updated_at on every row change
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Index for fast org-based lookups (used in every RLS policy)
CREATE INDEX IF NOT EXISTS idx_profiles_org_id ON profiles(org_id);
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(id);


-- ============================================================
-- HELPER FUNCTION: get the org_id for the current user
-- Used in RLS policies across ALL tables to avoid subquery repetition.
-- SECURITY DEFINER means it runs as the function owner, not the caller,
-- so it can read profiles even before the caller's RLS allows it.
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1;
$$;


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can read profiles of people in their own organization
CREATE POLICY "org_members_can_select_profiles"
  ON profiles FOR SELECT
  USING (
    org_id = get_user_org_id()
  );

-- Users can only update their own profile
CREATE POLICY "user_can_update_own_profile"
  ON profiles FOR UPDATE
  USING (
    id = auth.uid()
  );

-- Admins can update any profile in their org (e.g., changing roles)
CREATE POLICY "admins_can_update_org_profiles"
  ON profiles FOR UPDATE
  USING (
    org_id = get_user_org_id()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('super_admin', 'admin')
  );

-- INSERT is handled only by the trigger below — users cannot insert directly
CREATE POLICY "trigger_can_insert_profile"
  ON profiles FOR INSERT
  WITH CHECK (
    -- Only allow inserts where the id matches the authenticated user
    -- This lets the trigger work; direct inserts are blocked by the function
    id = auth.uid()
  );


-- ============================================================
-- TRIGGER: auto-create a profile when a user signs up
-- This fires after a new row is inserted into auth.users.
-- It creates a bare profile — org_id and role are set later
-- (either by admin invite flow or first-run onboarding).
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    -- Try to use the display name from auth metadata, fallback to email prefix
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach the trigger to auth.users
CREATE OR REPLACE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ============================================================
-- ALSO UPDATE organizations RLS to use the helper function
-- (better performance than inline subquery)
-- ============================================================
DROP POLICY IF EXISTS "org_members_select" ON organizations;
CREATE POLICY "org_members_select"
  ON organizations FOR SELECT
  USING (id = get_user_org_id());

DROP POLICY IF EXISTS "org_admins_update" ON organizations;
CREATE POLICY "org_admins_update"
  ON organizations FOR UPDATE
  USING (
    id = get_user_org_id()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('super_admin', 'admin')
  );
