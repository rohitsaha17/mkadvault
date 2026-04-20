"use client";
// Action buttons for campaign detail page: extend, create invoice, download proposal
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarPlus, FileText, Receipt, Loader2 } from "lucide-react";
import { extendCampaign } from "@/app/[locale]/(dashboard)/campaigns/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CampaignStatus } from "@/lib/types/database";

interface Props {
  campaignId: string;
  campaignStatus: CampaignStatus;
  clientId: string;
  currentEndDate: string | null;
}

export function CampaignDetailActions({ campaignId, campaignStatus, clientId, currentEndDate }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showExtend, setShowExtend] = useState(false);
  const [newEndDate, setNewEndDate] = useState(currentEndDate ?? "");

  function handleExtend() {
    if (!newEndDate) { toast.error("Please select a new end date"); return; }
    startTransition(async () => {
      const result = await extendCampaign(campaignId, newEndDate);
      if (result.error) { toast.error(result.error); return; }
      toast.success("Campaign extended");
      setShowExtend(false);
      router.refresh();
    });
  }

  const canExtend = ["confirmed", "creative_received", "printing", "mounted", "live"].includes(campaignStatus);
  const canCreateInvoice = !["enquiry", "cancelled"].includes(campaignStatus);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Download Proposal — available at enquiry or proposal_sent */}
      {["enquiry", "proposal_sent"].includes(campaignStatus) && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => router.push(`/proposals/new?campaign_id=${campaignId}`)}
        >
          <FileText className="h-4 w-4" />
          Proposal
        </Button>
      )}

      {/* Create Invoice */}
      {canCreateInvoice && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => router.push(`/billing/invoices/new?campaign_id=${campaignId}&client_id=${clientId}`)}
        >
          <Receipt className="h-4 w-4" />
          Create Invoice
        </Button>
      )}

      {/* Extend Campaign */}
      {canExtend && (
        <>
          {showExtend ? (
            <div className="flex items-center gap-2 p-2 rounded-lg border border-border bg-muted/30">
              <Input
                type="date"
                value={newEndDate}
                onChange={(e) => setNewEndDate(e.target.value)}
                className="h-8 w-40 text-sm"
                min={currentEndDate ?? undefined}
              />
              <Button size="sm" className="h-8" onClick={handleExtend} disabled={isPending}>
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Extend"}
              </Button>
              <Button size="sm" variant="ghost" className="h-8" onClick={() => setShowExtend(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setShowExtend(true)}
            >
              <CalendarPlus className="h-4 w-4" />
              Extend
            </Button>
          )}
        </>
      )}
    </div>
  );
}
