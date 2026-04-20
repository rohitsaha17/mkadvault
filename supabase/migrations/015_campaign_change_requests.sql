-- Campaign change requests: required for editing confirmed+ campaigns
-- An approved request reverts the campaign to enquiry so changes can be made

CREATE TABLE IF NOT EXISTS campaign_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  campaign_id UUID NOT NULL REFERENCES campaigns(id),
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  reviewed_by UUID REFERENCES auth.users(id),

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reason TEXT NOT NULL,
  rejection_reason TEXT,

  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for quick lookups
CREATE INDEX idx_change_requests_campaign ON campaign_change_requests(campaign_id);
CREATE INDEX idx_change_requests_status ON campaign_change_requests(status) WHERE status = 'pending';

-- Auto-update updated_at
CREATE TRIGGER set_updated_at_change_requests
  BEFORE UPDATE ON campaign_change_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE campaign_change_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org change requests"
  ON campaign_change_requests FOR SELECT
  USING (organization_id = (SELECT org_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert own org change requests"
  ON campaign_change_requests FOR INSERT
  WITH CHECK (organization_id = (SELECT org_id FROM profiles WHERE id = auth.uid()));

-- Only admin/manager can approve/reject
CREATE POLICY "Admins can update change requests"
  ON campaign_change_requests FOR UPDATE
  USING (
    organization_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('super_admin', 'admin', 'sales_manager')
  );
