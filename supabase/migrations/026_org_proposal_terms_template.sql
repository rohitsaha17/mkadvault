-- Migration 026: Add organization-level proposal / rate-card T&C template.
--
-- The proposal wizard already supports per-proposal terms_text. Teams
-- typically want one canonical set of T&C reused across every proposal
-- and rate card, editable without leaving the wizard. We store that
-- template as a single text column on `organizations`.
--
-- A fresh proposal defaults `terms_text` to this template; users can
-- edit for that one proposal, or click "Save as organization default"
-- to push the edits back here.
--
-- Nullable so existing tenants aren't forced to fill it in — the
-- wizard treats NULL/empty as "no template yet".

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS proposal_terms_template TEXT;

COMMENT ON COLUMN organizations.proposal_terms_template IS
  'Org-wide default text used to pre-fill the Terms & Conditions section of proposals and rate cards. Editable per-proposal; null means no template set.';
