-- ─────────────────────────────────────────────────────────────────────────────
-- Wipe ALL business data across every organization
-- ─────────────────────────────────────────────────────────────────────────────
-- What this does:
--   * Deletes every row from every business-data table.
--   * KEEPS organizations rows.
--   * KEEPS profiles rows.
--   * KEEPS auth.users (no one has to re-register).
--   * KEEPS alert_preferences (per-user preference, not business data).
--
-- After running, every org's dashboard will be empty but fully usable —
-- same users, same roles, same org settings, zero business data.
--
-- How to run:
--   1. Supabase dashboard → SQL Editor → New query
--   2. Paste this whole file
--   3. Click "Run" — you'll see row counts for each table at the end
--
-- Safety:
--   Everything runs in a transaction. If any DELETE fails, nothing is committed.
--   Re-running is safe (second run deletes 0 rows).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

WITH
  -- ── Delete in dependency order (children before parents) ────────────────────
  del_campaign_activity     AS (DELETE FROM campaign_activity_log     RETURNING 1),
  del_campaign_changes      AS (DELETE FROM campaign_change_requests  RETURNING 1),
  del_campaign_services     AS (DELETE FROM campaign_services         RETURNING 1),
  del_campaign_sites        AS (DELETE FROM campaign_sites            RETURNING 1),
  del_campaigns             AS (DELETE FROM campaigns                 RETURNING 1),

  del_proposal_sites        AS (DELETE FROM proposal_sites            RETURNING 1),
  del_proposals             AS (DELETE FROM proposals                 RETURNING 1),

  del_payments_received     AS (DELETE FROM payments_received         RETURNING 1),
  del_invoice_line_items    AS (DELETE FROM invoice_line_items        RETURNING 1),
  del_invoices              AS (DELETE FROM invoices                  RETURNING 1),

  del_contract_payments     AS (DELETE FROM contract_payments         RETURNING 1),
  del_contract_amendments   AS (DELETE FROM contract_amendments       RETURNING 1),
  del_contracts             AS (DELETE FROM contracts                 RETURNING 1),

  del_clients               AS (DELETE FROM clients                   RETURNING 1),

  del_site_photos           AS (DELETE FROM site_photos               RETURNING 1),
  del_sites                 AS (DELETE FROM sites                     RETURNING 1),

  del_landowners            AS (DELETE FROM landowners                RETURNING 1),
  del_partner_agencies      AS (DELETE FROM partner_agencies          RETURNING 1),

  del_alerts                AS (DELETE FROM alerts                    RETURNING 1)

-- ── Row-count summary ─────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM del_campaigns)              AS deleted_campaigns,
  (SELECT COUNT(*) FROM del_campaign_sites)         AS deleted_campaign_sites,
  (SELECT COUNT(*) FROM del_campaign_services)      AS deleted_campaign_services,
  (SELECT COUNT(*) FROM del_campaign_activity)      AS deleted_campaign_activity,
  (SELECT COUNT(*) FROM del_campaign_changes)       AS deleted_campaign_change_requests,
  (SELECT COUNT(*) FROM del_proposals)              AS deleted_proposals,
  (SELECT COUNT(*) FROM del_proposal_sites)         AS deleted_proposal_sites,
  (SELECT COUNT(*) FROM del_invoices)               AS deleted_invoices,
  (SELECT COUNT(*) FROM del_invoice_line_items)     AS deleted_invoice_line_items,
  (SELECT COUNT(*) FROM del_payments_received)      AS deleted_payments_received,
  (SELECT COUNT(*) FROM del_contracts)              AS deleted_contracts,
  (SELECT COUNT(*) FROM del_contract_payments)      AS deleted_contract_payments,
  (SELECT COUNT(*) FROM del_contract_amendments)    AS deleted_contract_amendments,
  (SELECT COUNT(*) FROM del_clients)                AS deleted_clients,
  (SELECT COUNT(*) FROM del_sites)                  AS deleted_sites,
  (SELECT COUNT(*) FROM del_site_photos)            AS deleted_site_photos,
  (SELECT COUNT(*) FROM del_landowners)             AS deleted_landowners,
  (SELECT COUNT(*) FROM del_partner_agencies)       AS deleted_partner_agencies,
  (SELECT COUNT(*) FROM del_alerts)                 AS deleted_alerts;

COMMIT;
