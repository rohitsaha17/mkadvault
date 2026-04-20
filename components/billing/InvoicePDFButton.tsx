"use client";
// PDF download button — uses react-pdf's PDFDownloadLink with dynamic import (no SSR)
import dynamic from "next/dynamic";
import { Loader2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InvoiceDocumentProps } from "./InvoiceDocument";

// Dynamically import PDFDownloadLink to avoid SSR
const PDFDownloadLink = dynamic(
  () => import("@react-pdf/renderer").then((m) => m.PDFDownloadLink),
  { ssr: false }
);

// Dynamically import the document itself so @react-pdf doesn't run server-side
const InvoiceDocument = dynamic(
  () => import("./InvoiceDocument").then((m) => m.InvoiceDocument),
  { ssr: false }
);

interface Props extends InvoiceDocumentProps {
  filename: string;
}

export function InvoicePDFButton(props: Props) {
  return (
    <PDFDownloadLink
      document={<InvoiceDocument {...props} />}
      fileName={props.filename}
    >
      {({ loading }: { loading: boolean }) => (
        <Button variant="outline" size="sm" disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          {loading ? "Generating PDF…" : "Download PDF"}
        </Button>
      )}
    </PDFDownloadLink>
  );
}
