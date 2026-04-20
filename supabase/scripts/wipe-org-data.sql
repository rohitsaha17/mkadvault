-- ─────────────────────────────────────────────────────────────────────────────
-- Wipe all business data for a single organization — Option A
-- ─────────────────────────────────────────────────────────────────────────────
-- What this does:
--   * Deletes every row of business data scoped to one organization.
--   * KEEPS the organizations row itself.
--   * KEEPS the profiles rows (so users stay logged in with the same org).
--   * KEEPS auth.users (no one has to re-register).
--
-- After running, the org's dashboard will be empty but fully usable —
-- same users, same roles, same org settings, zero business data.
--
-- How to run:
--   1. Open Supabase dashboard → SQL Editor → New query
--   2. Paste this whole file
--   3. Edit the WHERE clause at the top (TARGET_ORG) to match the org you want
--   4. Click "Run" — you'll see a row-count summary at the end
--
-- Safety:
--   The whole thing runs in a transaction. If any statement fails, nothing is
--   committed. If the org ID doesn't match any row, zero rows are deleted.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Configure the target org here ─────────────────────────────────────────────
-- Option 1: Use the org NAME (case-sensitive — check how it's stored)
WITH target AS (
  SELECT id FROM organizations WHERE name = 'MK ADD Communication Service'
)

-- Option 2: Or comment out the block above and hardcode the UUID instead:
-- WITH target AS (SELECT 'YOUR-ORG-UUID-HERE'::uuid AS id)

-- ── Wipe in dependency order (children first) ─────────────────────────────────
, del_campaign_activity AS (
  DELETE FROM campaign_activity_log
  WHERE campaign_id IN (SELECT id FROM campaigns WHERE organization_id IN (SELECT id FROM target))
  RETURNING 1
)
, del_campaign_changes AS (
  DELETE FROM campaign_change_requests
  WHERE organization_id IN (SELECT id FROM target)
  RETURNING 1
)
, del_campaign_sites AS (
  DELETE FROM campaign_sites
  WHERE organization_id IN (SELECT id FROM target)
  RETURNING 1
)
, del_campaign_services AS (
  DELETE FROM campaign_services
  WHERE campaign_id IN (SELECT id FROM campaigns WHERE organization_id IN (SELECT id FROM target))
  RETURNING 1
)
, del_campaigns AS (
  DELETE FROM campaigns
  WHERE organization_id IN (SELECT id FROM target)
  RETURNING 1
)
, del_proposal_sites AS (
  DELETE FROM proposal_sites
  WHERE proposal_id IN (SELECT id FROM proposals WHERE organization_id IN (SELECT id FROM target))
  RETURNING 1
)
, del_proposals AS (
  DELETE FROM proposals
  WHERE organization_id IN (SELECT id FROM target)
  RETURNING 1
)
, del_payments_received AS (
  DELETE FROM payments_received
  WHERE organization_id IN (SELECT id FROM target)
  RETURNING 1
)
, del_invoice_line_items AS (
  DELETE FROM invoice_line_items
  WHERE organization_id IN (SELECT id FROM target)
  RETURNING 1
)
, del_invoices AS (
  DELETE FROM invoices
  WHERE organization_id IN (SELECT id FROM target)
  RETURNING 1
)
, del_contract_payments AS (
  DELETE FROM contract_payments
  WHERE contract_id IN (SELECT id FROM contracts WHERE organization_id IN (SELECT id FROM target))
  RETURNING 1
)
, del_contract_amendments AS (
  DELETE FROM contract_amendments
  WHERE contract_id IN (SELECT id FROM contracts WHERE organization_id IN (SELECT id FROM target))
  RETURNING 1
)
, del_contracts AS (
  DELETE FROM contracts
  WHERE organization_id IN (SELECT id FROM target)
  RETURNING 1
)
, del_clients AS (
  DELETE FROM clients
  WHERE organization_id IN (SELECT id FROM target)
  RETURNING 1
)
, del_site_photos AS (
  DELETE FROM site_photos
  WHERE site_id IN (SELECT id FROM sites WHERE organization_id IN (SELECT id FROM target))
  RETURNING 1
)
, del_sites AS (
  DELETE FROM sites
  WHERE organization_id IN (SELECT id FROM target)
  RETURNING 1
)
, del_landowners AS (
  DELETE FROM landowners
  WHERE organization_id IN (SELECT id FROM target)
  RETURNING 1
)
, del_partner_agencies AS (
  DELETE FROM partner_agencies
  WHERE organization_id IN (SELECT id FROM target)
  RETURNING 1
)
, del_alerts AS (
  DELETE FROM alerts
  WHERE organization_id IN (SELECT id FROM target)
  RETURNING 1
)
-- NB: we intentionally keep alert_preferences (user preference, not business data)

-- ── Row-count summary ─────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM del_campaigns)           AS deleted_campaigns,
  (SELECT COUNT(*) FROM del_campaign_sites)      AS deleted_campaign_sites,
  (SELECT COUNT(*) FROM del_campaign_services)   AS deleted_campaign_services,
  (SELECT COUNT(*) FROM del_campaign_activity)   AS deleted_campaign_activity,
  (SELECT COUNT(*) FROM del_campaign_changes)    AS deleted_campaign_change_requests,
  (SELECT COUNT(*) FROM del_proposals)           AS deleted_proposals,
  (SELECT COUNT(*) FROM del_proposal_sites)      AS deleted_proposal_sites,
  (SELECT COUNT(*) FROM del_invoices)            AS deleted_invoices,
  (SELECT COUNT(*) FROM del_invoice_line_items)  AS deleted_invoice_line_items,
  (SELECT COUNT(*) FROM del_payments_received)   AS deleted_payments_received,
  (SELECT COUNT(*) FROM del_contracts)           AS deleted_contracts,
  (SELECT COUNT(*) FROM del_contract_payments)   AS deleted_contract_payments,
  (SELECT COUNT(*) FROM del_contract_amendments) AS deleted_contract_amendments,
  (SELECT COUNT(*) FROM del_clients)             AS deleted_clients,
  (SELECT COUNT(*) FROM del_sites)               AS deleted_sites,
  (SELECT COUNT(*) FROM del_site_photos)         AS deleted_site_photos,
  (SELECT COUNT(*) FROM del_landowners)          AS deleted_landowners,
  (SELECT COUNT(*) FROM del_partner_agencies)    AS deleted_partner_agencies,
  (SELECT COUNT(*) FROM del_alerts)              AS deleted_alerts;

COMMIT;
