-- Migration 039 — proposals can now be addressed to an agency OR a client
--
-- Rate cards and proposals are often sent to partner agencies (who then
-- resell to their end client) as well as to direct clients. Until now
-- the proposals table only had client_id, forcing the user to awkwardly
-- pick a client even when the real recipient was an agency.
--
-- We add:
--   agency_id       — nullable FK to partner_agencies
--   recipient_type  — 'client' | 'agency' | null; optional hint for the
--                     UI. Keeping it explicit avoids ambiguity when both
--                     client_id and agency_id happen to be filled in
--                     (future feature: billing a client on behalf of an
--                     agency, mirroring the campaigns pattern).
--
-- Existing rows: recipient_type stays NULL. The UI infers from
-- whichever column is populated. New proposals created through the
-- wizard set it explicitly.

BEGIN;

ALTER TABLE public.proposals
  ADD COLUMN agency_id      UUID
    REFERENCES partner_agencies(id) ON DELETE SET NULL,
  ADD COLUMN recipient_type TEXT
    CHECK (recipient_type IN ('client', 'agency'));

-- Fast filter for "all rate cards sent to a given agency".
CREATE INDEX idx_proposals_agency
  ON proposals(agency_id)
  WHERE agency_id IS NOT NULL AND deleted_at IS NULL;

COMMIT;
