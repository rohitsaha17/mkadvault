-- ─────────────────────────────────────────────────────────────────────────────
-- 010_create_proposals.sql
-- Sprint 6: Proposal Builder — proposals and proposal_sites tables
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── proposals ───────────────────────────────────────────────────────────────

CREATE TABLE proposals (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                UUID        REFERENCES auth.users(id),
  updated_by                UUID        REFERENCES auth.users(id),
  deleted_at                TIMESTAMPTZ,

  proposal_name             TEXT        NOT NULL,
  client_id                 UUID        REFERENCES clients(id) ON DELETE SET NULL,

  -- Layout & display
  template_type             TEXT        NOT NULL DEFAULT 'grid'
    CHECK (template_type IN ('grid', 'list', 'one_per_page', 'compact')),
  show_rates                TEXT        NOT NULL DEFAULT 'exact'
    CHECK (show_rates IN ('exact', 'range', 'request_quote', 'hidden')),
  show_photos               BOOLEAN     NOT NULL DEFAULT true,
  show_map                  BOOLEAN     NOT NULL DEFAULT true,
  show_dimensions           BOOLEAN     NOT NULL DEFAULT true,
  show_illumination         BOOLEAN     NOT NULL DEFAULT true,
  show_traffic_info         BOOLEAN     NOT NULL DEFAULT true,
  show_availability         BOOLEAN     NOT NULL DEFAULT true,

  -- Branding & content
  include_company_branding  BOOLEAN     NOT NULL DEFAULT true,
  include_terms             BOOLEAN     NOT NULL DEFAULT false,
  terms_text                TEXT,
  include_contact_details   BOOLEAN     NOT NULL DEFAULT true,
  custom_header_text        TEXT,
  custom_footer_text        TEXT,

  -- Lifecycle
  status                    TEXT        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'viewed', 'accepted', 'rejected')),
  sent_to_email             TEXT,
  sent_at                   TIMESTAMPTZ,
  viewed_at                 TIMESTAMPTZ,

  -- Generated files (Supabase Storage paths)
  pdf_url                   TEXT,
  pptx_url                  TEXT,

  notes                     TEXT
);

CREATE TRIGGER set_proposals_updated_at
  BEFORE UPDATE ON proposals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_proposals_org    ON proposals (organization_id);
CREATE INDEX idx_proposals_client ON proposals (organization_id, client_id);
CREATE INDEX idx_proposals_status ON proposals (organization_id, status);

-- ─── proposal_sites ──────────────────────────────────────────────────────────

CREATE TABLE proposal_sites (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  proposal_id      UUID        NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  site_id          UUID        NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Optional per-proposal overrides
  custom_rate_paise  BIGINT,
  custom_notes       TEXT,
  display_order      INTEGER     NOT NULL DEFAULT 0
);

CREATE INDEX idx_proposal_sites_proposal ON proposal_sites (proposal_id);
CREATE INDEX idx_proposal_sites_org      ON proposal_sites (organization_id);

-- ─── RLS — proposals ─────────────────────────────────────────────────────────

ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_proposals" ON proposals
  FOR SELECT USING (organization_id = get_user_org_id());

CREATE POLICY "org_insert_proposals" ON proposals
  FOR INSERT WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY "org_update_proposals" ON proposals
  FOR UPDATE USING (organization_id = get_user_org_id());

CREATE POLICY "org_delete_proposals" ON proposals
  FOR DELETE USING (organization_id = get_user_org_id());

-- ─── RLS — proposal_sites ────────────────────────────────────────────────────

ALTER TABLE proposal_sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_proposal_sites" ON proposal_sites
  FOR SELECT USING (organization_id = get_user_org_id());

CREATE POLICY "org_insert_proposal_sites" ON proposal_sites
  FOR INSERT WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY "org_update_proposal_sites" ON proposal_sites
  FOR UPDATE USING (organization_id = get_user_org_id());

CREATE POLICY "org_delete_proposal_sites" ON proposal_sites
  FOR DELETE USING (organization_id = get_user_org_id());
