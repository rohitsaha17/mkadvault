-- ─── 013_sites_landowner_link_and_remove_traded.sql ──────────────────────────
-- 1. Removes 'traded' from the ownership_model_enum — only owned | rented remain.
-- 2. Adds a direct `landowner_id` column on `sites` with a constraint.
--
-- Postgres does not support DROP VALUE on an enum, so we:
--    a) rename the existing enum to a temp name
--    b) create a new enum with the desired values
--    c) drop the column default, alter type (mapping 'traded' → 'owned'), restore default
--    d) drop the old enum
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Remove 'traded' from ownership_model_enum ────────────────────────────────

-- a) rename old enum out of the way
ALTER TYPE ownership_model_enum RENAME TO ownership_model_enum_old;

-- b) create the new enum without 'traded'
CREATE TYPE ownership_model_enum AS ENUM ('owned', 'rented');

-- c) migrate the column, mapping 'traded' → 'owned'
--    Drop the default first so ALTER TYPE doesn't conflict.
ALTER TABLE sites ALTER COLUMN ownership_model DROP DEFAULT;
ALTER TABLE sites
  ALTER COLUMN ownership_model TYPE ownership_model_enum
  USING (
    CASE ownership_model::text
      WHEN 'traded' THEN 'owned'::ownership_model_enum
      ELSE ownership_model::text::ownership_model_enum
    END
  );
ALTER TABLE sites
  ALTER COLUMN ownership_model SET DEFAULT 'owned'::ownership_model_enum;

-- d) drop the old enum
DROP TYPE ownership_model_enum_old;

-- 2. landowner_id foreign key ─────────────────────────────────────────────────
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS landowner_id UUID REFERENCES landowners(id) ON DELETE SET NULL;

-- Index for reverse lookups (find all sites for a given landowner)
CREATE INDEX IF NOT EXISTS idx_sites_landowner
  ON sites (landowner_id)
  WHERE deleted_at IS NULL;

-- Safety constraint: only sites with ownership_model = 'owned' may carry a
-- landowner_id. Rented sites are linked via contracts to a partner_agency.
ALTER TABLE sites
  ADD CONSTRAINT sites_landowner_only_if_owned
  CHECK (landowner_id IS NULL OR ownership_model = 'owned');
