"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ChevronRight, XCircle, RotateCcw } from "lucide-react";
import { updateCampaignStatus, cancelCampaign, revertToEnquiry } from "@/app/[locale]/(dashboard)/campaigns/actions";
import { Button } from "@/components/ui/button";
import type { CampaignStatus, ServiceType } from "@/lib/types/database";

interface Props {
  campaignId: string;
  currentStatus: CampaignStatus;
  // Service types included in this campaign — used to determine which steps to show
  serviceTypes: ServiceType[];
}

// Build dynamic workflow based on included services
function buildWorkflow(serviceTypes: ServiceType[]): { status: CampaignStatus; label: string }[] {
  const base: { status: CampaignStatus; label: string }[] = [
    { status: "enquiry", label: "Enquiry" },
    { status: "proposal_sent", label: "Proposal Sent" },
    { status: "confirmed", label: "Confirmed" },
  ];

  const hasCreative = serviceTypes.some((t) => t === "design" || t === "display_rental");
  const hasPrinting = serviceTypes.some((t) => t === "flex_printing");
  const hasMounting = serviceTypes.some((t) => t === "mounting");

  if (hasCreative) base.push({ status: "creative_received", label: "Creative" });
  if (hasPrinting) base.push({ status: "printing", label: "Printing" });
  if (hasMounting) base.push({ status: "mounted", label: "Mounted" });

  base.push({ status: "live", label: "Live" });
  base.push({ status: "completed", label: "Completed" });

  return base;
}

export function CampaignStatusBar({ campaignId, currentStatus, serviceTypes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const WORKFLOW = buildWorkflow(serviceTypes);
  const currentIdx = WORKFLOW.findIndex((s) => s.status === currentStatus);
  const nextStep = currentIdx >= 0 && currentIdx < WORKFLOW.length - 1 ? WORKFLOW[currentIdx + 1] : null;

  function advance() {
    if (!nextStep) return;
    startTransition(async () => {
      const result = await updateCampaignStatus(campaignId, nextStep.status);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`Status updated to ${nextStep.label}`);
        router.refresh();
      }
    });
  }

  function handleRevert() {
    startTransition(async () => {
      const result = await revertToEnquiry(campaignId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Reverted to Enquiry for changes");
        router.refresh();
      }
    });
  }

  function handleCancel() {
    startTransition(async () => {
      const result = await cancelCampaign(campaignId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Campaign cancelled");
        router.refresh();
      }
    });
    setShowCancelConfirm(false);
  }

  // Cancelled or dismounted — show special state
  if (currentStatus === "cancelled") {
    return (
      <div className="flex items-center justify-between gap-3 p-4 border border-rose-200 dark:border-rose-500/30 rounded-lg bg-rose-50 dark:bg-rose-500/10">
        <span className="text-sm font-medium text-rose-700 dark:text-rose-300">Campaign Cancelled</span>
      </div>
    );
  }

  if (currentStatus === "dismounted") {
    return (
      <div className="flex items-center gap-3 p-4 border rounded-lg bg-muted/30">
        <span className="text-sm font-medium text-muted-foreground">Campaign Dismounted</span>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      {/* Status stepper */}
      <div className="flex items-center gap-0 overflow-x-auto pb-1">
        {WORKFLOW.map((step, i) => {
          const isDone = currentIdx >= 0 && i < currentIdx;
          const isActive = i === currentIdx;
          return (
            <div key={step.status} className="flex items-center shrink-0">
              <div className={`px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground border-primary"
                  : isDone
                  ? "bg-primary/10 text-primary border-primary/20"
                  : "bg-muted text-muted-foreground border-border"
              }`}>
                {step.label}
              </div>
              {i < WORKFLOW.length - 1 && (
                <ChevronRight className={`h-3.5 w-3.5 mx-0.5 shrink-0 ${isDone ? "text-primary/40" : "text-border"}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Actions row */}
      <div className="flex items-center gap-3 pt-1 border-t border-border flex-wrap">
        {/* Next step */}
        {nextStep && (
          <>
            <span className="text-xs text-muted-foreground">
              Next: <strong>{nextStep.label}</strong>
            </span>
            <button
              onClick={advance}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 disabled:opacity-50"
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              Mark as {nextStep.label}
            </button>
          </>
        )}

        {/* Reject / Revert — only on proposal_sent */}
        {currentStatus === "proposal_sent" && (
          <button
            onClick={handleRevert}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 hover:text-amber-700 disabled:opacity-50 ml-auto"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reject / Make Changes
          </button>
        )}

        {/* Cancel — available anytime (except completed/cancelled) */}
        {!["completed", "cancelled", "dismounted"].includes(currentStatus) && (
          <div className="ml-auto relative">
            {showCancelConfirm ? (
              <div className="flex items-center gap-2 p-2 rounded-md border border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10">
                <span className="text-xs text-rose-700 dark:text-rose-300">Cancel this campaign?</span>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-6 text-xs px-2"
                  onClick={handleCancel}
                  disabled={isPending}
                >
                  {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Yes, Cancel"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs px-2"
                  onClick={() => setShowCancelConfirm(false)}
                >
                  No
                </Button>
              </div>
            ) : (
              <button
                onClick={() => setShowCancelConfirm(true)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-rose-600 transition-colors"
              >
                <XCircle className="h-3.5 w-3.5" />
                Cancel Campaign
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
