"use client";
// Plain anchor styled like a Button. Server-side PDF rendering — see
// PaymentRequestPDFButton for the full rationale.

import { Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  invoiceId: string;
}

export function InvoicePDFButton({ invoiceId }: Props) {
  return (
    <a
      href={`/api/pdf/invoice/${invoiceId}`}
      download
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-2")}
    >
      <Download className="h-4 w-4" />
      Download PDF
    </a>
  );
}
