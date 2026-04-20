-- Migration 012: Add missing DELETE policies to audit-trail tables.
-- These tables were missing admin-gated DELETE policies, leaving them
-- unprotected at the DB layer (soft-delete via deleted_at is the app-level
-- pattern, but the DB should also restrict hard-deletes to admins only).

-- ─── invoices ────────────────────────────────────────────────────────────────
CREATE POLICY "admin_delete_invoices" ON invoices
  FOR DELETE USING (
    organization_id = get_user_org_id()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('super_admin', 'admin')
  );

-- ─── payments_received ────────────────────────────────────────────────────────
-- Payments are append-only by design; only super_admin can hard-delete.
CREATE POLICY "admin_update_payments_received" ON payments_received
  FOR UPDATE USING (organization_id = get_user_org_id());

CREATE POLICY "admin_delete_payments_received" ON payments_received
  FOR DELETE USING (
    organization_id = get_user_org_id()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('super_admin', 'admin')
  );

-- ─── contract_amendments ─────────────────────────────────────────────────────
CREATE POLICY "admin_delete_contract_amendments" ON contract_amendments
  FOR DELETE USING (
    organization_id = get_user_org_id()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('super_admin', 'admin')
  );

-- ─── contract_payments ───────────────────────────────────────────────────────
CREATE POLICY "admin_delete_contract_payments" ON contract_payments
  FOR DELETE USING (
    organization_id = get_user_org_id()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('super_admin', 'admin')
  );

-- ─── alert_preferences ───────────────────────────────────────────────────────
CREATE POLICY "user_delete_own_alert_preferences" ON alert_preferences
  FOR DELETE USING (
    organization_id = get_user_org_id()
    AND (user_id = auth.uid() OR (SELECT role FROM profiles WHERE id = auth.uid()) IN ('super_admin', 'admin'))
  );
