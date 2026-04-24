"use client";
// Action buttons for campaign detail page: extend, create invoice,
// download proposal, delete.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarPlus, FileText, Receipt, Loader2, Trash2 } from "lucide-react";
import { callAction } from "@/lib/utils/call-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CampaignStatus } from "@/lib/types/database";

interface Props {
  campaignId: string;
  campaignStatus: CampaignStatus;
  clientId: string;
  currentEndDate: string | null;
  campaignName?: string | null;
  // Whether the caller has permission to delete. Computed server-side
  // (admin / super_admin / manager) and passed in — easier to keep the
  // authoritative check on the server and just reflect it here.
  canDelete?: boolean;
}

export function CampaignDetailActions({
  campaignId,
  campaignStatus,
  clientId,
  currentEndDate,
  campaignName,
  canDelete = false,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();
  const [showExtend, setShowExtend] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [newEndDate, setNewEndDate] = useState(currentEndDate ?? "");

  function handleDelete() {
    startDeleteTransition(async () => {
      try {
        // Use the stable Route Handler URL — Server Action hashes change
        // across deploys and cause "An unexpected response…" errors for
        // users with old tabs open.
        const res = await fetch(`/api/campaigns/${campaignId}`, {
          method: "DELETE",
          credentials: "same-origin",
        });
        const data = await res.json().catch(() => ({ error: "Invalid server response" }));
        if (data?.error) { toast.error(data.error); return; }
        toast.success("Campaign deleted");
        router.push("/campaigns");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Delete failed");
      }
    });
    setShowDeleteConfirm(false);
  }

  function handleExtend() {
    if (!newEndDate) { toast.error("Please select a new end date"); return; }
    startTransition(async () => {
      try {
        const result = await callAction<{ error?: string }>(
          "extendCampaign",
          campaignId,
          newEndDate,
        );
        if (result.error) { toast.error(result.error); return; }
        toast.success("Campaign extended");
        setShowExtend(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Extend failed");
      }
    });
  }

  // With the simplified status model only a live campaign makes
  // sense to extend. Invoices can still be raised on completed
  // campaigns (historical billing), but not on cancelled ones.
  const canExtend = campaignStatus === "live";
  const canCreateInvoice = campaignStatus !== "cancelled";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Download Proposal — always available on non-cancelled
          campaigns. Proposals are decoupled from status in the
          simplified workflow. */}
      {campaignStatus !== "cancelled" && (
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

      {/* Delete Campaign — admin/super_admin/manager only. Two-step
          confirm inline so we can show the campaign name in the prompt. */}
      {canDelete && (
        <>
          {showDeleteConfirm ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs">
              <span className="text-destructive">
                Delete{campaignName ? ` "${campaignName}"` : " this campaign"}? This soft-deletes the record.
              </span>
              <Button
                size="sm"
                variant="destructive"
                className="h-8"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Yes, Delete"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-destructive hover:border-destructive/50 hover:text-destructive"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          )}
        </>
      )}
    </div>
  );
}
