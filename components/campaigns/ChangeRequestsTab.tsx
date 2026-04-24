"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import { callAction } from "@/lib/utils/call-action";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CampaignChangeRequest } from "@/lib/types/database";

interface Props {
  requests: CampaignChangeRequest[];
  // Accepts the roles[] array so multi-role users (exec + accountant) are
  // handled correctly alongside single-role users.
  userRoles: string[];
}

const STATUS_STYLE: Record<string, { icon: React.ReactNode; classes: string }> = {
  pending: { icon: <Clock className="h-4 w-4" />, classes: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400" },
  approved: { icon: <CheckCircle2 className="h-4 w-4" />, classes: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400" },
  rejected: { icon: <XCircle className="h-4 w-4" />, classes: "bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400" },
};

export function ChangeRequestsTab({ requests, userRoles }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const canReview = userRoles.some((r) =>
    ["super_admin", "admin", "manager", "executive"].includes(r)
  );

  function handleApprove(requestId: string) {
    startTransition(async () => {
      try {
        const result = await callAction<{ error?: string }>(
          "reviewCampaignChangeRequest",
          requestId,
          { status: "approved" },
        );
        if (result.error) {
          toast.error(result.error);
        } else {
          toast.success("Change request approved");
          router.refresh();
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Approve failed");
      }
    });
  }

  function handleReject(requestId: string) {
    startTransition(async () => {
      try {
        const result = await callAction<{ error?: string }>(
          "reviewCampaignChangeRequest",
          requestId,
          {
            status: "rejected",
            rejection_reason: rejectionReason.trim() || undefined,
          },
        );
        if (result.error) {
          toast.error(result.error);
        } else {
          toast.success("Change request rejected");
          setReviewingId(null);
          setRejectionReason("");
          router.refresh();
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Reject failed");
      }
    });
  }

  if (requests.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-10 text-center">
        <PenLineIcon className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">No change requests.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {requests.map((req) => {
        const style = STATUS_STYLE[req.status] ?? STATUS_STYLE.pending;
        return (
          <div key={req.id} className="rounded-xl border border-border p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <p className="text-sm text-foreground">{req.reason}</p>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  Requested {format(new Date(req.requested_at), "dd MMM yyyy, HH:mm")}
                </p>
              </div>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${style.classes}`}>
                {style.icon}
                {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
              </span>
            </div>

            {req.status === "rejected" && req.rejection_reason && (
              <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 rounded-lg px-3 py-2">
                Rejection reason: {req.rejection_reason}
              </p>
            )}

            {req.reviewed_at && (
              <p className="text-xs text-muted-foreground tabular-nums">
                Reviewed {format(new Date(req.reviewed_at), "dd MMM yyyy, HH:mm")}
              </p>
            )}

            {/* Admin actions for pending requests */}
            {req.status === "pending" && canReview && (
              <div className="flex items-start gap-2 pt-2 border-t border-border">
                {reviewingId === req.id ? (
                  <div className="flex-1 space-y-2">
                    <Textarea
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      placeholder="Reason for rejection (optional)..."
                      rows={2}
                      className="text-sm"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleReject(req.id)}
                        disabled={isPending}
                      >
                        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm Reject"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setReviewingId(null); setRejectionReason(""); }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="default"
                      className="gap-1.5"
                      onClick={() => handleApprove(req.id)}
                      disabled={isPending}
                    >
                      {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-rose-600 hover:text-rose-700"
                      onClick={() => setReviewingId(req.id)}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Reject
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Small icon for empty state
function PenLineIcon({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" /><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
    </svg>
  );
}
