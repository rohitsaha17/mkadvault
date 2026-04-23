-- Drop the client_type column from clients.
-- Classification of clients as direct_client / agency / government is no
-- longer used. Agency relationships are tracked via partner_agencies, and
-- campaign-level billing party (campaigns.billing_party_type +
-- billed_agency_id) captures who's invoiced for each booking.
--
-- Safe to drop: nothing else in the schema references clients.client_type.

BEGIN;

DROP INDEX IF EXISTS idx_clients_type;
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_client_type_check;
ALTER TABLE clients DROP COLUMN IF EXISTS client_type;

COMMIT;
