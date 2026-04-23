-- Migration 030 — campaign_jobs
-- Tracks printing and mounting (and other) jobs linked to a campaign
-- and optionally a specific site/campaign_site. Each job can be done
-- in-house (source='internal', cost_paise NULL) or outsourced to an
-- external vendor (source='external', cost_paise >= 0).
--
-- When outsourced and a cost is set, the app optionally links a
-- matching site_expenses row (payment request) so the accounts team
-- can approve + pay the vendor through the existing Finance flow.
-- The link is stored in campaign_jobs.expense_id.
--
-- RLS: org isolation via get_user_org_id() (defined in migration 002).

BEGIN;

CREATE TABLE public.campaign_jobs (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by          UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by          UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at          TIMESTAMPTZ,

  -- Links. campaign_id is required (a job always belongs to a campaign).
  -- campaign_site_id is optional — some jobs span multiple sites (e.g. a
  -- bulk print order) and the user creates one row per covered site, or
  -- leaves it null for campaign-wide jobs. site_id is denormalised for
  -- simpler site-centric reporting.
  campaign_id         UUID         NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  campaign_site_id    UUID         REFERENCES campaign_sites(id) ON DELETE SET NULL,
  site_id             UUID         REFERENCES sites(id) ON DELETE SET NULL,

  -- Job type and source
  job_type            TEXT         NOT NULL CHECK (job_type IN (
                                    'print', 'mount', 'print_and_mount',
                                    'unmount', 'repair', 'other'
                                  )),
  source              TEXT         NOT NULL DEFAULT 'internal'
                                     CHECK (source IN ('internal', 'external')),

  -- Vendor (only relevant when source='external')
  vendor_name         TEXT,
  vendor_agency_id    UUID         REFERENCES partner_agencies(id) ON DELETE SET NULL,
  vendor_contact      TEXT,

  -- Lifecycle
  status              TEXT         NOT NULL DEFAULT 'pending'
                                     CHECK (status IN (
                                       'pending', 'in_progress',
                                       'completed', 'cancelled'
                                     )),
  scheduled_date      DATE,
  completed_date      DATE,

  -- Costs. Only set for external jobs.
  cost_paise          BIGINT       CHECK (cost_paise IS NULL OR cost_paise >= 0),
  -- If a payment request has been raised for this job, link to it so the
  -- approval/payment status can be read back from site_expenses.
  expense_id          UUID         REFERENCES site_expenses(id) ON DELETE SET NULL,

  description         TEXT         NOT NULL,
  notes               TEXT,

  -- Consistency: internal jobs should not carry a cost. External jobs
  -- don't require a cost up front (you might create the job before
  -- knowing the price) but if a cost is set, source must be external.
  CONSTRAINT campaign_jobs_internal_no_cost
    CHECK (source = 'external' OR cost_paise IS NULL),
  -- Can only have an expense link if external.
  CONSTRAINT campaign_jobs_internal_no_expense
    CHECK (source = 'external' OR expense_id IS NULL)
);

CREATE INDEX idx_campaign_jobs_org
  ON campaign_jobs(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_campaign_jobs_campaign
  ON campaign_jobs(campaign_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_campaign_jobs_site
  ON campaign_jobs(site_id) WHERE deleted_at IS NULL AND site_id IS NOT NULL;
CREATE INDEX idx_campaign_jobs_status
  ON campaign_jobs(organization_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_campaign_jobs_expense
  ON campaign_jobs(expense_id) WHERE expense_id IS NOT NULL;

-- updated_at auto-maintain
DROP TRIGGER IF EXISTS set_updated_at_campaign_jobs ON public.campaign_jobs;
CREATE TRIGGER set_updated_at_campaign_jobs
  BEFORE UPDATE ON public.campaign_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE public.campaign_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_can_select_campaign_jobs"
  ON campaign_jobs FOR SELECT
  USING (organization_id = get_user_org_id() AND deleted_at IS NULL);

CREATE POLICY "org_members_can_insert_campaign_jobs"
  ON campaign_jobs FOR INSERT
  WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY "org_members_can_update_campaign_jobs"
  ON campaign_jobs FOR UPDATE
  USING (organization_id = get_user_org_id());

CREATE POLICY "org_members_can_delete_campaign_jobs"
  ON campaign_jobs FOR DELETE
  USING (
    organization_id = get_user_org_id()
    AND (SELECT role FROM profiles WHERE id = auth.uid())
        IN ('super_admin', 'admin', 'manager')
  );

COMMIT;
