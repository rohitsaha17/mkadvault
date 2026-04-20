"use client";
// Combines PDF and PPTX export buttons for proposals.
// PDF button is dynamically imported (ssr:false) to avoid bundling @react-pdf server-side.
import dynamic from "next/dynamic";
import type { Proposal } from "@/lib/types/database";
import type { SiteForProposal } from "@/app/[locale]/(dashboard)/proposals/new/page";
import type { ProposalDocumentProps } from "./ProposalDocument";
import { ProposalPptxButton } from "./ProposalPptxButton";

// Dynamic import keeps @react-pdf out of the SSR bundle
const ProposalPDFButton = dynamic(
  () => import("./ProposalPDFButton").then((m) => m.ProposalPDFButton),
  { ssr: false }
);

interface Props {
  proposal: Proposal;
  sites: SiteForProposal[];
  org: ProposalDocumentProps["org"];
  clientName?: string | null;
}

function safeFilename(name: string, ext: string): string {
  return name.replace(/[^a-z0-9]/gi, "_").toLowerCase() + "." + ext;
}

export function ProposalExportButtons({ proposal, sites, org, clientName }: Props) {
  const base = safeFilename(proposal.proposal_name || "proposal", "");
  const pdfFilename = base + "pdf";
  const pptxFilename = base + "pptx";

  return (
    <div className="flex flex-wrap gap-2">
      <ProposalPDFButton
        proposal={proposal}
        sites={sites}
        org={org}
        clientName={clientName}
        filename={pdfFilename}
      />
      <ProposalPptxButton
        proposal={proposal}
        sites={sites}
        org={org}
        filename={pptxFilename}
      />
    </div>
  );
}
