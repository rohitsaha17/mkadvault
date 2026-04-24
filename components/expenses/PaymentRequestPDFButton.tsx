"use client";
// Dynamic-import wrapper around @react-pdf/renderer's PDFDownloadLink.
// We must keep @react-pdf off the server — it pulls in browser-only
// canvas / DOM APIs that throw during SSR. Mirrors InvoicePDFButton.
import dynamic from "next/dynamic";
import { Loader2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PaymentRequestDocumentProps } from "./PaymentRequestDocument";

const PDFDownloadLink = dynamic(
  () => import("@react-pdf/renderer").then((m) => m.PDFDownloadLink),
  { ssr: false },
);

const PaymentRequestDocument = dynamic(
  () =>
    import("./PaymentRequestDocument").then((m) => m.PaymentRequestDocument),
  { ssr: false },
);

interface Props extends PaymentRequestDocumentProps {
  filename: string;
}

export function PaymentRequestPDFButton({ filename, ...docProps }: Props) {
  return (
    <PDFDownloadLink
      document={<PaymentRequestDocument {...docProps} />}
      fileName={filename}
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
