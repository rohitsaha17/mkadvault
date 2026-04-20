-- ─── 008_create_campaigns.sql ────────────────────────────────────────────────
-- Campaigns, campaign_sites (junction), campaign_services (line items),
-- and campaign_activity_log (audit trail).
--
-- Design notes:
-- • campaign_code: auto-generated as CAM-YYYYMM-NNN scoped per org+month.
--   Done in a BEFORE INSERT trigger using a counter function.
-- • campaign_sites links a campaign to specific sites, with per-site financials.
-- • campaign_services holds additional service line items (printing, mounting, etc.)
-- • campaign_activity_log is an append-only audit trail.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── campaigns ────────────────────────────────────────────────────────────────

CREATE TABLE campaigns (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID        REFERENCES auth.users(id),
  updated_by          UUID        REFERENCES auth.users(id),
  deleted_at          TIMESTAMPTZ,

  -- Auto-generated code like CAM-202604-001
  campaign_code       TEXT,

  client_id           UUID        NOT NULL REFERENCES clients(id),
  campaign_name       TEXT        NOT NULL,

  start_date          DATE,
  end_date            DATE,

  status              TEXT        NOT NULL DEFAULT 'enquiry'
    CHECK (status IN (
      'enquiry', 'proposal_sent', 'confirmed', 'creative_received',
      'printing', 'mounted', 'live', 'completed', 'dismounted'
    )),

  -- Total campaign value in paise (1 INR = 100 paise)
  total_value_paise   BIGINT,

  pricing_type        TEXT        NOT NULL DEFAULT 'itemized'
    CHECK (pricing_type IN ('itemized', 'bundled')),

  notes               TEXT
);

-- Auto-update updated_at
CREATE TRIGGER set_campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Auto-generate campaign_code before insert
-- Format: CAM-YYYYMM-NNN (sequential counter per org per month, zero-padded to 3 digits)
CREATE OR REPLACE FUNCTION generate_campaign_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_prefix TEXT;
  v_seq    INTEGER;
BEGIN
  v_prefix := 'CAM-' || to_char(now(), 'YYYYMM');

  SELECT COALESCE(MAX(
    (regexp_match(campaign_code, '-(\d+)$'))[1]::INTEGER
  ), 0) + 1
  INTO v_seq
  FROM campaigns
  WHERE organization_id = NEW.organization_id
    AND campaign_code LIKE v_prefix || '-%';

  NEW.campaign_code := v_prefix || '-' || lpad(v_seq::TEXT, 3, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_campaign_code
  BEFORE INSERT ON campaigns
  FOR EACH ROW
  WHEN (NEW.campaign_code IS NULL)
  EXECUTE FUNCTION generate_campaign_code();

-- ─── Row Level Security — campaigns ──────────────────────────────────────────

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaigns_select" ON campaigns FOR SELECT
  USING (organization_id = get_user_org_id() AND deleted_at IS NULL);

CREATE POLICY "campaigns_insert" ON campaigns FOR INSERT
  WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY "campaigns_update" ON campaigns FOR UPDATE
  USING (organization_id = get_user_org_id());

CREATE POLICY "campaigns_delete" ON campaigns FOR DELETE
  USING (
    organization_id = get_user_org_id()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('super_admin', 'admin')
  );

-- ─── Indexes — campaigns ──────────────────────────────────────────────────────

CREATE INDEX idx_campaigns_org ON campaigns(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_campaigns_client ON campaigns(organization_id, client_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_campaigns_status ON campaigns(organization_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_campaigns_dates ON campaigns(organization_id, start_date, end_date) WHERE deleted_at IS NULL;

-- ─── campaign_sites ───────────────────────────────────────────────────────────
-- Junction: which sites are booked in each campaign, with per-site details.

CREATE TABLE campaign_sites (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  campaign_id           UUID        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  site_id               UUID        NOT NULL REFERENCES sites(id),

  -- Financial — display rate charged to client for this site per month
  display_rate_paise    BIGINT,

  -- Per-site dates (can differ from campaign start/end)
  start_date            DATE,
  end_date              DATE,

  -- Creative details
  creative_file_url     TEXT,
  creative_size_width   DECIMAL(10, 2),
  creative_size_height  DECIMAL(10, 2),

  -- Execution / mounting
  mounting_date         DATE,
  dismounting_date      DATE,
  mounting_photo_url    TEXT,

  -- Per-site status within the campaign
  status                TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'creative_received', 'printing', 'mounted', 'live', 'dismounted'
    )),

  notes                 TEXT,

  -- A site can only appear once per campaign
  UNIQUE (campaign_id, site_id)
);

CREATE TRIGGER set_campaign_sites_updated_at
  BEFORE UPDATE ON campaign_sites
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE campaign_sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaign_sites_select" ON campaign_sites FOR SELECT
  USING (organization_id = get_user_org_id());

CREATE POLICY "campaign_sites_insert" ON campaign_sites FOR INSERT
  WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY "campaign_sites_update" ON campaign_sites FOR UPDATE
  USING (organization_id = get_user_org_id());

CREATE POLICY "campaign_sites_delete" ON campaign_sites FOR DELETE
  USING (organization_id = get_user_org_id());

CREATE INDEX idx_campaign_sites_campaign ON campaign_sites(campaign_id);
CREATE INDEX idx_campaign_sites_site ON campaign_sites(site_id);
CREATE INDEX idx_campaign_sites_org ON campaign_sites(organization_id);

-- ─── campaign_services ────────────────────────────────────────────────────────
-- Additional service line items per campaign (printing, mounting, design, etc.)

CREATE TABLE campaign_services (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  campaign_id     UUID        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,

  -- Optionally tied to a specific site
  site_id         UUID        REFERENCES sites(id),

  service_type    TEXT        NOT NULL
    CHECK (service_type IN (
      'display_rental', 'flex_printing', 'mounting', 'design', 'transport', 'other'
    )),

  description     TEXT,
  quantity        INTEGER     NOT NULL DEFAULT 1,
  rate_paise      BIGINT      NOT NULL DEFAULT 0,
  total_paise     BIGINT      NOT NULL DEFAULT 0  -- quantity * rate_paise, stored for convenience
);

CREATE TRIGGER set_campaign_services_updated_at
  BEFORE UPDATE ON campaign_services
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE campaign_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaign_services_select" ON campaign_services FOR SELECT
  USING (organization_id = get_user_org_id());

CREATE POLICY "campaign_services_insert" ON campaign_services FOR INSERT
  WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY "campaign_services_update" ON campaign_services FOR UPDATE
  USING (organization_id = get_user_org_id());

CREATE POLICY "campaign_services_delete" ON campaign_services FOR DELETE
  USING (organization_id = get_user_org_id());

CREATE INDEX idx_campaign_services_campaign ON campaign_services(campaign_id);
CREATE INDEX idx_campaign_services_org ON campaign_services(organization_id);

-- ─── campaign_activity_log ────────────────────────────────────────────────────
-- Append-only audit trail for all actions on a campaign.

CREATE TABLE campaign_activity_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  campaign_id     UUID        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id         UUID        REFERENCES profiles(id),

  action          TEXT        NOT NULL
    CHECK (action IN (
      'status_changed', 'note_added', 'file_uploaded', 'payment_received',
      'site_added', 'site_removed', 'created', 'updated'
    )),

  description     TEXT,
  old_value       TEXT,
  new_value       TEXT
);

-- No update trigger — this is append-only
ALTER TABLE campaign_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaign_activity_log_select" ON campaign_activity_log FOR SELECT
  USING (organization_id = get_user_org_id());

CREATE POLICY "campaign_activity_log_insert" ON campaign_activity_log FOR INSERT
  WITH CHECK (organization_id = get_user_org_id());

CREATE INDEX idx_campaign_activity_campaign ON campaign_activity_log(campaign_id);
CREATE INDEX idx_campaign_activity_org ON campaign_activity_log(organization_id, created_at DESC);
