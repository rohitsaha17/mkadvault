"use client";
// Proposal / rate-card export — PPTX only.
//
// Note: we used to also offer PDF download (react-pdf). Removed per
// product direction — the PPTX export is the single source of truth,
// easier to edit after generation, and already branded with the org
// logo + contact details. Keeping ProposalPDFButton + ProposalDocument
// in the repo for now in case we need to restore it later, but nothing
// imports them anymore.
import type { Proposal } from "@/lib/types/database";
import type { SiteForProposal } from "@/app/[locale]/(dashboard)/proposals/new/page";
import type { ProposalDocumentProps } from "./ProposalDocument";
import { ProposalPptxButton } from "./ProposalPptxButton";

interface Props {
  proposal: Proposal;
  sites: SiteForProposal[];
  org: ProposalDocumentProps["org"];
  // Signed URL for the org logo (if uploaded) — embedded on the cover
  // + contact slides in the PPTX. The page that renders this component
  // generates a short-lived signed URL server-side.
  orgLogoUrl?: string | null;
  clientName?: string | null;
}

function safeFilename(name: string, ext: string): string {
  return name.replace(/[^a-z0-9]/gi, "_").toLowerCase() + "." + ext;
}

export function ProposalExportButtons({ proposal, sites, org, orgLogoUrl }: Props) {
  const base = safeFilename(proposal.proposal_name || "proposal", "");
  const pptxFilename = base + "pptx";

  return (
    <div className="flex flex-wrap gap-2">
      <ProposalPptxButton
        proposal={proposal}
        sites={sites}
        org={org}
        orgLogoUrl={orgLogoUrl ?? null}
        filename={pptxFilename}
      />
    </div>
  );
}
