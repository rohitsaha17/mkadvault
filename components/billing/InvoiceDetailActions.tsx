"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send, Trash2, IndianRupee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RecordInvoicePaymentDialog } from "./RecordInvoicePaymentDialog";
import { InvoicePDFButton } from "./InvoicePDFButton";
import { callAction } from "@/lib/utils/call-action";
import type { InvoiceStatus } from "@/lib/types/database";

interface Props {
  invoiceId: string;
  invoiceNumber: string;
  currentStatus: InvoiceStatus;
  balanceDuePaise: number;
  // Whether to show the Download PDF link. The page passes false when
  // critical fields (client, org) are missing — the server route
  // would 400 otherwise.
  showPdf?: boolean;
}

export function InvoiceDetailActions({ invoiceId, invoiceNumber, currentStatus, balanceDuePaise, showPdf = true }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);

  const canSend = currentStatus === "draft";
  const canPay = ["sent", "partially_paid", "overdue"].includes(currentStatus) && balanceDuePaise > 0;
  const canDelete = ["draft", "cancelled"].includes(currentStatus);

  function handleMarkSent() {
    startTransition(async () => {
      try {
        const result = await callAction<{ error?: string }>(
          "updateInvoiceStatus",
          invoiceId,
          "sent",
        );
        if (result.error) { toast.error(result.error); return; }
        toast.success("Invoice marked as sent");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Update failed");
      }
    });
  }

  function handleDelete() {
    if (!confirm(`Delete invoice ${invoiceNumber}? This cannot be undone.`)) return;
    startTransition(async () => {
      try {
        const result = await callAction<{ error?: string }>("deleteInvoice", invoiceId);
        if (result.error) { toast.error(result.error); return; }
        toast.success("Invoice deleted");
        router.push("/billing/invoices");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Delete failed");
      }
    });
  }

  return (
    <>
      {showPdf && <InvoicePDFButton invoiceId={invoiceId} />}

      {canSend && (
        <Button variant="outline" size="sm" onClick={handleMarkSent} disabled={isPending}>
          <Send className="h-4 w-4 mr-2" />
          Mark as Sent
        </Button>
      )}
      {canPay && (
        <Button size="sm" onClick={() => setShowPaymentDialog(true)}>
          <IndianRupee className="h-4 w-4 mr-2" />
          Record Payment
        </Button>
      )}
      {canDelete && (
        <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={handleDelete} disabled={isPending}>
          <Trash2 className="h-4 w-4" />
        </Button>
      )}

      {showPaymentDialog && (
        <RecordInvoicePaymentDialog
          invoiceId={invoiceId}
          invoiceNumber={invoiceNumber}
          balanceDuePaise={balanceDuePaise}
          onClose={() => setShowPaymentDialog(false)}
          onSuccess={() => { router.refresh(); }}
        />
      )}
    </>
  );
}
