"use client";
// Plain anchor styled like a Button. Hits /api/pdf/payment-request/[id]
// which renders the PDF server-side. We keep client-side @react-pdf
// out of the bundle entirely — its v4.x reconciler crashes under
// React 19 with "su is not a function" the moment PDFDownloadLink
// mounts, taking the whole page down with it.

import { Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  expenseId: string;
}

export function PaymentRequestPDFButton({ expenseId }: Props) {
  return (
    <a
      href={`/api/pdf/payment-request/${expenseId}`}
      // The browser uses the route's content-disposition filename
      // when `download` is set; the empty value here just opts in.
      download
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-2")}
    >
      <Download className="h-4 w-4" />
      Download PDF
    </a>
  );
}
