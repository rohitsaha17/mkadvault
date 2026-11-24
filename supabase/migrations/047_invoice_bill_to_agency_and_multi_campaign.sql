-- ─────────────────────────────────────────────────────────────────────────────
-- 047_invoice_bill_to_agency_and_multi_campaign.sql
--
-- Two shape changes to invoices, both additive so older rows keep working:
--
--   1. bill-to party can now be an AGENCY, not just a direct client. An
--      invoice raised against a campaign whose billing_party_type =
--      'agency' goes to that partner agency; a direct-client campaign
--      still works exactly as before. We add:
--        - invoices.bill_to_type ('client'|'agency')  default 'client'
--        - invoices.billed_agency_id  (nullable FK to partner_agencies)
--      and relax invoices.client_id to NULL so only ONE of the two is
--      set per row, enforced by a check constraint.
--
--   2. ONE invoice can now cover MULTIPLE campaigns — a single bill to
--      an agency might consolidate three campaigns in one go. We don't
--      build a many-to-many on invoices itself (keeps the row simple);
--      instead we tag each LINE ITEM with its source campaign via a new
--      invoice_line_items.campaign_id. That naturally produces "one
--      invoice, N line groups, one per campaign" without a junction
--      table. invoices.campaign_id stays as the "primary campaign" for
--      listings and backward compatibility.
--
-- Idempotent: all ALTERs use IF NOT EXISTS / DO $$ guards so the file
-- can be run twice without error.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. invoices.bill_to_type ────────────────────────────────────────────────

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS bill_to_type TEXT NOT NULL DEFAULT 'client';

-- CHECK constraint: only 'client' or 'agency'. Drop-then-add so the
-- file survives a re-run that found a different enum.
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_bill_to_type_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_bill_to_type_check
  CHECK (bill_to_type IN ('client', 'agency'));

-- ─── 2. invoices.billed_agency_id ─────────────────────────────────────────────

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS billed_agency_id UUID
  REFERENCES public.partner_agencies(id);

-- Only one of client_id / billed_agency_id can be set, and it must
-- match bill_to_type. We allow client_id OR billed_agency_id but never
-- both, and the one that is set must match bill_to_type.
ALTER TABLE public.invoices
  ALTER COLUMN client_id DROP NOT NULL;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_bill_to_consistent;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_bill_to_consistent CHECK (
    (bill_to_type = 'client' AND client_id      IS NOT NULL AND billed_agency_id IS NULL)
    OR
    (bill_to_type = 'agency' AND billed_agency_id IS NOT NULL AND client_id      IS NULL)
  );

-- Index so "invoices for agency X" is cheap on the agency detail page.
CREATE INDEX IF NOT EXISTS invoices_billed_agency_idx
  ON public.invoices (organization_id, billed_agency_id)
  WHERE billed_agency_id IS NOT NULL AND deleted_at IS NULL;

-- ─── 3. invoice_line_items.campaign_id ───────────────────────────────────────

-- Tag each line with its source campaign so one invoice can cover
-- several campaigns and the PDF / listings can group by campaign.
ALTER TABLE public.invoice_line_items
  ADD COLUMN IF NOT EXISTS campaign_id UUID
  REFERENCES public.campaigns(id);

CREATE INDEX IF NOT EXISTS invoice_line_items_campaign_idx
  ON public.invoice_line_items (organization_id, campaign_id)
  WHERE campaign_id IS NOT NULL;

-- ─── 4. Backfill — mirror invoices.campaign_id onto existing lines ───────────

-- Legacy invoices have invoices.campaign_id set but no line.campaign_id.
-- Copy the invoice-level campaign down to its lines so the new "group
-- by campaign" render still shows those lines correctly.
UPDATE public.invoice_line_items li
   SET campaign_id = i.campaign_id
  FROM public.invoices i
 WHERE li.invoice_id   = i.id
   AND i.campaign_id   IS NOT NULL
   AND li.campaign_id  IS NULL;
