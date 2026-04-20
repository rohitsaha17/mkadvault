"use client";
// Proposal PDF download button — dynamically imported to avoid SSR bundling @react-pdf
import dynamic from "next/dynamic";
import { Loader2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProposalDocumentProps } from "./ProposalDocument";

const PDFDownloadLink = dynamic(
  () => import("@react-pdf/renderer").then((m) => m.PDFDownloadLink),
  { ssr: false }
);

const ProposalDocument = dynamic(
  () => import("./ProposalDocument").then((m) => m.ProposalDocument),
  { ssr: false }
);

interface Props extends ProposalDocumentProps {
  filename: string;
}

export function ProposalPDFButton(props: Props) {
  return (
    <PDFDownloadLink
      document={<ProposalDocument {...props} />}
      fileName={props.filename}
    >
      {({ loading }: { loading: boolean }) => (
        <Button variant="outline" size="sm" disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <FileText className="h-4 w-4 mr-2" />
          )}
          {loading ? "Generating PDF…" : "Download PDF"}
        </Button>
      )}
    </PDFDownloadLink>
  );
}
