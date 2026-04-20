-- Migration 021: Add custom_dimensions (JSONB) column to sites
--
-- Why:
--   Width + height cover most billboards, but some structures (unipoles,
--   wraps, irregular hoardings) need additional measurements such as
--   "Depth", "Circumference", or "Pole Height". Rather than hard-coding
--   more columns, we store an array of {label, value} entries so the form
--   can add as many custom dimensions as the user needs.
--
-- Shape:
--   [
--     { "label": "Depth",          "value": "3 ft" },
--     { "label": "Pole Height",    "value": "25 ft" }
--   ]
--
-- The column is nullable and defaults to an empty array.

BEGIN;

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS custom_dimensions JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN sites.custom_dimensions IS
  'Array of {label, value} entries for dimensions beyond width/height.';

COMMIT;
