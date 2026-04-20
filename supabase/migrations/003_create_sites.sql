-- ─── 003_create_sites.sql ────────────────────────────────────────────────────
-- Creates the `sites` and `site_photos` tables, enables RLS, and adds indexes.
--
-- Design notes:
-- • base_rate_paise: stored as bigint (integer paise) to avoid floating-point
--   rounding when doing arithmetic. Display layer converts to INR (÷100).
-- • total_sqft: generated column so it is always in sync with width/height.
-- • deleted_at: soft-delete — never hard-delete business records.
-- • organization_id on every table for multi-tenant isolation (Phase 2).
-- • get_user_org_id() defined in migration 002 — used in all RLS policies.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── ENUM types ───────────────────────────────────────────────────────────────

CREATE TYPE media_type_enum AS ENUM (
  'billboard', 'hoarding', 'dooh', 'kiosk',
  'wall_wrap', 'unipole', 'bus_shelter', 'custom'
);

CREATE TYPE illumination_enum AS ENUM ('frontlit', 'backlit', 'digital', 'nonlit');

CREATE TYPE facing_enum AS ENUM ('N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW');

CREATE TYPE traffic_side_enum AS ENUM ('lhs', 'rhs', 'both');

CREATE TYPE ownership_model_enum AS ENUM ('owned', 'rented', 'traded');

CREATE TYPE structure_type_enum AS ENUM ('permanent', 'temporary', 'digital');

CREATE TYPE site_status_enum AS ENUM (
  'available', 'booked', 'maintenance', 'blocked', 'expired'
);

CREATE TYPE photo_type_enum AS ENUM ('day', 'night', 'closeup', 'longshot', 'other');

-- ─── sites ────────────────────────────────────────────────────────────────────

CREATE TABLE sites (
  -- Standard audit columns
  id                           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id              UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at                   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by                   UUID          REFERENCES auth.users(id),
  updated_by                   UUID          REFERENCES auth.users(id),
  deleted_at                   TIMESTAMPTZ,   -- NULL = active; non-NULL = soft-deleted

  -- Identity
  site_code                    TEXT          NOT NULL,  -- e.g. "MUM-BKC-001", unique per org
  name                         TEXT          NOT NULL,

  -- Classification
  media_type                   media_type_enum    NOT NULL,
  structure_type               structure_type_enum NOT NULL DEFAULT 'permanent',
  status                       site_status_enum   NOT NULL DEFAULT 'available',

  -- Location
  address                      TEXT          NOT NULL,
  city                         TEXT          NOT NULL,
  state                        TEXT          NOT NULL,
  pincode                      TEXT,
  landmark                     TEXT,
  latitude                     NUMERIC(9, 6),   -- e.g. 19.075984
  longitude                    NUMERIC(9, 6),   -- e.g. 72.877656

  -- Physical specs
  width_ft                     NUMERIC(8, 2),
  height_ft                    NUMERIC(8, 2),
  -- total_sqft is auto-calculated; no need to set it manually
  total_sqft                   NUMERIC(10, 2) GENERATED ALWAYS AS (width_ft * height_ft) STORED,
  illumination                 illumination_enum,
  facing                       facing_enum,
  traffic_side                 traffic_side_enum,
  visibility_distance_m        INTEGER,         -- how far the site is visible in metres

  -- Commercial
  ownership_model              ownership_model_enum NOT NULL DEFAULT 'owned',
  -- Rate stored as integer paise (1 INR = 100 paise) to avoid float rounding.
  -- e.g. ₹50,000/month → 5000000 paise. Display: value / 100 formatted as INR.
  base_rate_paise              BIGINT,

  -- Regulatory
  municipal_permission_number  TEXT,
  municipal_permission_expiry  DATE,

  -- Misc
  notes                        TEXT,

  -- Phase 2 marketplace fields (unused in Phase 1, kept for forward compatibility)
  is_marketplace_listed        BOOLEAN       NOT NULL DEFAULT false,
  marketplace_visibility_settings JSONB      DEFAULT '{}',

  -- Uniqueness: site_code must be unique within an org (not globally)
  UNIQUE (organization_id, site_code)
);

-- auto-update updated_at on every row change
CREATE TRIGGER set_sites_updated_at
  BEFORE UPDATE ON sites
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── site_photos ──────────────────────────────────────────────────────────────

CREATE TABLE site_photos (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id         UUID        NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID        REFERENCES auth.users(id),

  -- Storage path within the "site-photos" Supabase Storage bucket
  -- e.g. "{org_id}/{site_id}/abc123.jpg"
  photo_url       TEXT        NOT NULL,
  photo_type      photo_type_enum NOT NULL DEFAULT 'day',
  is_primary      BOOLEAN     NOT NULL DEFAULT false,
  sort_order      INTEGER     NOT NULL DEFAULT 0
);

CREATE TRIGGER set_site_photos_updated_at
  BEFORE UPDATE ON site_photos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Only one photo per site can be primary — enforced via partial unique index
CREATE UNIQUE INDEX site_photos_one_primary_per_site
  ON site_photos (site_id)
  WHERE is_primary = true;

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Most list queries filter by org + active records, so this compound index
-- covers the common WHERE organization_id = ? AND deleted_at IS NULL pattern.
CREATE INDEX idx_sites_org_active
  ON sites (organization_id, deleted_at NULLS FIRST);

-- Filter by city within an org
CREATE INDEX idx_sites_org_city
  ON sites (organization_id, city)
  WHERE deleted_at IS NULL;

-- Filter by media type within an org
CREATE INDEX idx_sites_org_media_type
  ON sites (organization_id, media_type)
  WHERE deleted_at IS NULL;

-- Filter by status within an org (e.g. "show only available sites")
CREATE INDEX idx_sites_org_status
  ON sites (organization_id, status)
  WHERE deleted_at IS NULL;

-- Filter by ownership model (for cost analysis: rented vs owned)
CREATE INDEX idx_sites_org_ownership
  ON sites (organization_id, ownership_model)
  WHERE deleted_at IS NULL;

-- Lookup photos for a site quickly
CREATE INDEX idx_site_photos_site_id
  ON site_photos (site_id);

-- ─── Row Level Security — sites ───────────────────────────────────────────────

ALTER TABLE sites ENABLE ROW LEVEL SECURITY;

-- SELECT: users can see their org's non-deleted sites
CREATE POLICY "Users can view own org sites" ON sites
  FOR SELECT USING (
    organization_id = get_user_org_id()
    AND deleted_at IS NULL
  );

-- INSERT: org_id must match the session user's org
CREATE POLICY "Users can insert own org sites" ON sites
  FOR INSERT WITH CHECK (
    organization_id = get_user_org_id()
  );

-- UPDATE: same org only
CREATE POLICY "Users can update own org sites" ON sites
  FOR UPDATE USING (
    organization_id = get_user_org_id()
  );

-- DELETE (hard): restricted to admins — but we prefer soft-delete in the app
CREATE POLICY "Admins can delete own org sites" ON sites
  FOR DELETE USING (
    organization_id = get_user_org_id()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('super_admin', 'admin')
  );

-- ─── Row Level Security — site_photos ─────────────────────────────────────────

ALTER TABLE site_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org site photos" ON site_photos
  FOR SELECT USING (organization_id = get_user_org_id());

CREATE POLICY "Users can insert own org site photos" ON site_photos
  FOR INSERT WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY "Users can update own org site photos" ON site_photos
  FOR UPDATE USING (organization_id = get_user_org_id());

CREATE POLICY "Admins can delete own org site photos" ON site_photos
  FOR DELETE USING (
    organization_id = get_user_org_id()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('super_admin', 'admin')
  );
