-- Migration 041 — media-type-specific specs + flexible pricing
-- ──────────────────────────────────────────────────────────────────
-- A "site" used to be a flat rectangle: width × height × monthly rate.
-- That breaks down for the rest of the catalogue:
--   • DOOH sells per slot / per second / per month — quantity matters
--   • Unipole has 2-3 faces (L/T/V shapes) — can be sold per face or
--     packaged
--   • Kiosk rows have N independently-rentable kiosks
--   • Bus shelters have multiple panels
--   • Wall wraps are per square foot
--
-- Adding columns per type would balloon the table. JSONB on `sites`
-- keeps the schema flexible while we figure out which fields actually
-- get used; hot fields can graduate to columns later. Pricing model
-- stays in real columns since the totals math depends on it.
--
-- Migration is idempotent (IF NOT EXISTS) and backward-compatible: any
-- existing site keeps working with its current base_rate_paise as a
-- "flat_monthly × 1 unit" computation.

BEGIN;

-- ── 1. Type-specific specs blob ──────────────────────────────────────────
-- Shape varies by `media_type`. The TS-side discriminated union in
-- lib/types/database.ts is the source of truth for what each kind
-- looks like. Examples:
--   { kind: "dooh", slots_per_loop: 6, slot_duration_seconds: 10,
--                   loop_duration_seconds: 60, operating_hours_per_day: 16 }
--   { kind: "unipole", shape: "L", sides: [{ face: "N", width_ft: 40,
--                       height_ft: 20, illumination: "frontlit" }, ...] }
--   { kind: "kiosk", kiosk_count: 8, kiosks_sellable: 8,
--                    kiosk_dimensions_ft: { width: 4, height: 6 } }
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS media_specs JSONB;

-- ── 2. Pricing basis enum ────────────────────────────────────────────────
-- Says how to read base_rate_paise + billable_units. Default
-- preserves the old behaviour: every existing site is "flat_monthly
-- × 1 unit" so totals don't change.
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS pricing_basis TEXT
    CHECK (pricing_basis IN (
      'flat_monthly',         -- hoarding, billboard, package unipole
      'per_face_monthly',     -- unipole when sold per-face
      'per_kiosk_monthly',    -- kiosk strips; partial rentals OK
      'per_panel_monthly',    -- bus shelters
      'per_slot_monthly',     -- DOOH sold as a monthly slot package
      'per_slot',             -- DOOH ad-hoc per-slot pricing
      'per_second',           -- DOOH per-second pricing
      'per_sqft_monthly',     -- wall wraps, irregular surfaces
      'custom'                -- escape hatch for one-offs
    ))
    DEFAULT 'flat_monthly';

-- ── 3. Quantity that the unit rate multiplies against ────────────────────
-- Examples:
--   billboard:    pricing_basis=flat_monthly, base_rate=50000, units=1
--   unipole pkg:  pricing_basis=flat_monthly, base_rate=80000, units=1
--   unipole face: pricing_basis=per_face_monthly, base_rate=40000, units=2
--   kiosk row:    pricing_basis=per_kiosk_monthly, base_rate=5000, units=8
--   DOOH 30/day:  pricing_basis=per_slot, base_rate=200, units=30
-- NUMERIC(10,2) has plenty of headroom for whole-number counts
-- (kiosks) and fractional cases (per-second pricing on a 30-day month).
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS billable_units NUMERIC(10, 2)
    NOT NULL DEFAULT 1;

-- ── 4. Comments so future-you knows why these exist ──────────────────────
COMMENT ON COLUMN sites.media_specs IS
  'Type-specific spec blob. Shape varies by media_type — see MediaSpecs union in lib/types/database.ts. NULL on older rows defaults the form to a flat hoarding.';
COMMENT ON COLUMN sites.pricing_basis IS
  'How base_rate_paise should be interpreted (per face / per kiosk / per slot / per second / flat). Combined with billable_units to compute the effective monthly rate.';
COMMENT ON COLUMN sites.billable_units IS
  'Quantity that base_rate_paise multiplies against — number of faces / kiosks / slots-per-day / panels. 1 for flat-rate billboards.';

COMMIT;
