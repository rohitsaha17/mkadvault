"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, PenLine } from "lucide-react";
import { callAction } from "@/lib/utils/call-action";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Props {
  campaignId: string;
  hasPendingRequest: boolean;
}

export function ChangeRequestButton({ campaignId, hasPendingRequest }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  function handleSubmit() {
    if (reason.trim().length < 5) {
      toast.error("Please explain what changes are needed (min 5 characters)");
      return;
    }
    startTransition(async () => {
      try {
        const result = await callAction<{ error?: string }>(
          "createCampaignChangeRequest",
          campaignId,
          { reason: reason.trim() },
        );
        if (result.error) {
          toast.error(result.error);
        } else {
          toast.success("Change request submitted for approval");
          setOpen(false);
          setReason("");
          router.refresh();
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Submit failed");
      }
    });
  }

  if (hasPendingRequest) {
    return (
      <Button variant="outline" size="sm" className="gap-1.5" disabled>
        <PenLine className="h-4 w-4" />
        Change Requested
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs transition-all hover:bg-accent hover:text-accent-foreground h-8 cursor-pointer">
        <PenLine className="h-4 w-4" />
        Request Changes
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request Campaign Changes</DialogTitle>
          <DialogDescription>
            This campaign is confirmed and locked. Submit a change request for admin/manager approval.
            Once approved, the campaign will revert to Enquiry for editing and a fresh proposal will need
            to be sent.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              What changes are needed? <span className="text-destructive">*</span>
            </label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Client wants to add 2 more sites and change the campaign dates..."
              rows={4}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Submit Request
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
