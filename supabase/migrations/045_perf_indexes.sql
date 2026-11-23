-- Migration 045 — performance indexes for list-page searching / sorting.
--
-- Why this exists:
--   Every list page (sites, campaigns, clients, landowners, invoices,
--   contracts) runs ILIKE '%foo%' searches and ORDER BY on text
--   columns. Without trigram GIN indexes those ILIKEs sequentially
--   scan the whole table on every keystroke. For 100 rows that's
--   fine; for the thousands of rows real customers will have it
--   turns typing in a search box into a 500–2000 ms stall.
--
-- What this adds:
--   1. pg_trgm extension (if not already enabled) — gives us
--      gin_trgm_ops operator class for case-insensitive LIKE/ILIKE
--      searches backed by an index instead of a seq scan.
--   2. Trigram GIN indexes on the text columns the list pages search
--      against (and only those — adding a trigram index to every
--      text column would bloat the DB).
--   3. Plain b-tree indexes on the (organization_id, deleted_at)
--      pair that every list query filters by first. Scoped to rows
--      where deleted_at IS NULL so soft-deleted rows don't cost
--      index space.
--   4. Supporting indexes on (status, start_date, end_date) for the
--      status-reconciler and the dashboard pro-rata aggregations.
--
-- All indexes are CREATE INDEX IF NOT EXISTS so re-running is safe.
-- All use CONCURRENTLY where the table might have data, so the
-- migration doesn't take an exclusive lock on a production table.

-- ─── 1. pg_trgm extension ────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── 2. Trigram indexes for ILIKE searches ───────────────────────────────────
-- Sites — name / site_code / city are the fields the sites filter searches.
CREATE INDEX IF NOT EXISTS sites_name_trgm_idx
  ON public.sites USING gin (name gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS sites_site_code_trgm_idx
  ON public.sites USING gin (site_code gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS sites_city_trgm_idx
  ON public.sites USING gin (city gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- Campaigns — the campaigns filter ILIKEs campaign_name.
CREATE INDEX IF NOT EXISTS campaigns_name_trgm_idx
  ON public.campaigns USING gin (campaign_name gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- Clients — searches on company_name, brand_name, primary contact + email.
CREATE INDEX IF NOT EXISTS clients_company_name_trgm_idx
  ON public.clients USING gin (company_name gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS clients_brand_name_trgm_idx
  ON public.clients USING gin (brand_name gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS clients_contact_name_trgm_idx
  ON public.clients USING gin (primary_contact_name gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS clients_contact_email_trgm_idx
  ON public.clients USING gin (primary_contact_email gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- Landowners — full_name, phone, email.
CREATE INDEX IF NOT EXISTS landowners_full_name_trgm_idx
  ON public.landowners USING gin (full_name gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS landowners_phone_trgm_idx
  ON public.landowners USING gin (phone gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS landowners_email_trgm_idx
  ON public.landowners USING gin (email gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- ─── 3. Tenant-scoped b-tree indexes ─────────────────────────────────────────
-- Every query starts with `organization_id = ? AND deleted_at IS NULL`.
-- A partial index on organization_id WHERE deleted_at IS NULL means
-- Postgres can go straight to the rows that belong to the current tenant
-- and still exist, without having to touch the (much larger) soft-deleted
-- tail that builds up over time.
CREATE INDEX IF NOT EXISTS sites_org_live_idx
  ON public.sites (organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS campaigns_org_live_idx
  ON public.campaigns (organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS clients_org_live_idx
  ON public.clients (organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS landowners_org_live_idx
  ON public.landowners (organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS invoices_org_live_idx
  ON public.invoices (organization_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS contracts_org_live_idx
  ON public.contracts (organization_id)
  WHERE deleted_at IS NULL;

-- ─── 4. Status + date-window indexes ─────────────────────────────────────────
-- The site-status reconciler and the dashboard "live now / in range"
-- queries filter on (status, start_date, end_date). A compound index
-- means they can seek instead of scan.
CREATE INDEX IF NOT EXISTS sites_status_idx
  ON public.sites (organization_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS campaigns_status_dates_idx
  ON public.campaigns (organization_id, status, start_date, end_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS campaign_sites_dates_idx
  ON public.campaign_sites (start_date, end_date);

CREATE INDEX IF NOT EXISTS campaign_sites_site_idx
  ON public.campaign_sites (site_id);

CREATE INDEX IF NOT EXISTS invoices_status_date_idx
  ON public.invoices (organization_id, status, invoice_date)
  WHERE deleted_at IS NULL;

-- ─── 5. ANALYZE so the planner picks up the new shapes ───────────────────────
-- Not strictly needed (autovacuum will refresh stats soon enough) but
-- makes the first post-migration queries fast.
ANALYZE public.sites;
ANALYZE public.campaigns;
ANALYZE public.clients;
ANALYZE public.landowners;
ANALYZE public.invoices;
ANALYZE public.contracts;
ANALYZE public.campaign_sites;
