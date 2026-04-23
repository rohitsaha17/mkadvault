"use client";
// CampaignStatusBar — slim header that shows the campaign's current
// state and offers the single manual transition still available:
// Cancel. Since migration 035 the workflow collapsed to just three
// values (live → completed → cancelled), and completion is automatic
// (via the auto-complete cron once end_date passes), so there's no
// more "Mark as Proposal Sent / Confirmed / Live" button ladder.
//
// The Cancel action still goes through the stable Route Handler
// (/api/campaigns/[id]/cancel) to avoid Server-Action-hash churn
// across deploys.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CampaignStatus } from "@/lib/types/database";

interface Props {
  campaignId: string;
  currentStatus: CampaignStatus;
  endDate: string | null;
}

export function CampaignStatusBar({ campaignId, currentStatus, endDate }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  function handleCancel() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/cancel`, {
          method: "POST",
          credentials: "same-origin",
        });
        const data = await res.json().catch(() => ({ error: "Invalid server response" }));
        if (data?.error) {
          toast.error(data.error);
          return;
        }
        toast.success("Campaign cancelled");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Cancel failed");
      }
    });
    setShowCancelConfirm(false);
  }

  // Cancelled is terminal — nothing to do, just show the badge state.
  if (currentStatus === "cancelled") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 dark:border-rose-500/30 dark:bg-rose-500/10">
        <span className="text-sm font-medium text-rose-700 dark:text-rose-300">
          Campaign Cancelled
        </span>
      </div>
    );
  }

  // Completed is terminal in the same way — auto-flipped by the cron
  // once end_date has passed.
  if (currentStatus === "completed") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            Campaign Completed
          </span>
          {endDate && (
            <span className="text-xs text-emerald-700/80 dark:text-emerald-300/80">
              Ended on {new Date(endDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
            </span>
          )}
        </div>
      </div>
    );
  }

  // live — the only state with an action attached.
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-500/30 dark:bg-indigo-500/10">
      <div className="flex flex-col">
        <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
          Campaign Live
        </span>
        <span className="text-xs text-indigo-700/80 dark:text-indigo-300/80">
          {endDate
            ? `Auto-completes after ${new Date(endDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
            : "Will auto-complete once the end date is set and passes"}
        </span>
      </div>
      {showCancelConfirm ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-rose-700 dark:text-rose-300">
            Cancel this campaign and release its sites?
          </span>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleCancel}
            disabled={isPending}
            className="gap-1.5"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
            Yes, Cancel
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowCancelConfirm(false)}
            disabled={isPending}
          >
            No
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-destructive hover:border-destructive/50 hover:text-destructive"
          onClick={() => setShowCancelConfirm(true)}
        >
          <XCircle className="h-4 w-4" />
          Cancel Campaign
        </Button>
      )}
    </div>
  );
}
