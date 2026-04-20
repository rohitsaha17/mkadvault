-- 018_fix_audit_issues.sql
-- Fixes multiple issues found during the full app audit.

-- ─── 1. Add 'cancelled' to campaigns.status CHECK constraint ─────────────────
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_status_check
  CHECK (status IN (
    'enquiry', 'proposal_sent', 'confirmed', 'creative_received',
    'printing', 'mounted', 'live', 'completed', 'dismounted', 'cancelled'
  ));

-- ─── 2. Fix invoices SELECT RLS to exclude soft-deleted records ──────────────
DROP POLICY IF EXISTS "invoices_select" ON invoices;
CREATE POLICY "invoices_select" ON invoices FOR SELECT
  USING (
    organization_id = get_user_org_id()
    AND deleted_at IS NULL
  );

-- ─── 3. Fix total_amount_paise references — add alias column ─────────────────
-- The code references total_amount_paise but the column is total_paise.
-- Rather than changing all code references, add a generated column alias.
-- Actually, let's NOT do that — rename is cleaner. But we can't rename because
-- existing code also uses total_paise. Instead, we fix the code (done below).
-- This section is intentionally left as a comment — the fix is in TypeScript.

-- ─── 4. Add deleted_at filter to invoice_line_items SELECT if RLS exists ─────
-- invoice_line_items doesn't have deleted_at, so no change needed.

-- ─── 5. Restrict DELETE policies to admin roles where missing ────────────────

-- proposals
DROP POLICY IF EXISTS "proposals_delete" ON proposals;
CREATE POLICY "proposals_delete" ON proposals FOR DELETE
  USING (
    organization_id = get_user_org_id()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('super_admin', 'admin')
  );

-- proposal_sites
DROP POLICY IF EXISTS "proposal_sites_delete" ON proposal_sites;
CREATE POLICY "proposal_sites_delete" ON proposal_sites FOR DELETE
  USING (
    organization_id = get_user_org_id()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('super_admin', 'admin')
  );

-- campaign_sites
DROP POLICY IF EXISTS "campaign_sites_delete" ON campaign_sites;
CREATE POLICY "campaign_sites_delete" ON campaign_sites FOR DELETE
  USING (
    organization_id = get_user_org_id()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('super_admin', 'admin')
  );

-- campaign_services
DROP POLICY IF EXISTS "campaign_services_delete" ON campaign_services;
CREATE POLICY "campaign_services_delete" ON campaign_services FOR DELETE
  USING (
    organization_id = get_user_org_id()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('super_admin', 'admin')
  );

-- invoice_line_items
DROP POLICY IF EXISTS "invoice_line_items_delete" ON invoice_line_items;
CREATE POLICY "invoice_line_items_delete" ON invoice_line_items FOR DELETE
  USING (
    organization_id = get_user_org_id()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('super_admin', 'admin')
  );
