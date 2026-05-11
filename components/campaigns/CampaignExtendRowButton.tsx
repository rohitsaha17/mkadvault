"use client";
// Compact "Extend" action that fits inside the campaigns list row.
// Clicking the calendar-plus icon opens a popover with a date input
// and a confirm button; the detail page has the same flow with more
// breathing room. We can't reuse the detail-page component directly
// because it renders inline (eats horizontal space the row doesn't
// have) — but the server action call is identical.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarPlus, Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { callAction } from "@/lib/utils/call-action";

interface Props {
  campaignId: string;
  currentEndDate: string | null;
  // Hide the trigger entirely when the campaign is in a state where
  // extending doesn't make sense (cancelled, etc.). Computed by the
  // parent from the derived status.
  disabled?: boolean;
}

export function CampaignExtendRowButton({
  campaignId,
  currentEndDate,
  disabled = false,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Default to the current end date so the user only nudges it
  // forward rather than retyping. Empty when there's no end date.
  const [newEndDate, setNewEndDate] = useState(currentEndDate ?? "");

  function handleExtend() {
    if (!newEndDate) {
      toast.error("Pick a new end date");
      return;
    }
    if (currentEndDate && newEndDate <= currentEndDate) {
      toast.error("New end date must be after the current one");
      return;
    }
    startTransition(async () => {
      try {
        const result = await callAction<{ error?: string }>(
          "extendCampaign",
          campaignId,
          newEndDate,
        );
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success("Campaign extended");
        setOpen(false);
        // Refresh the list view so the new end date + recomputed total
        // appear immediately.
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Extend failed");
      }
    });
  }

  if (disabled) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Base UI's PopoverTrigger renders its own <button> by default,
          so we style it directly with buttonVariants instead of
          wrapping a Button + asChild (this codebase's Button doesn't
          ship Slot's asChild prop). */}
      <PopoverTrigger
        aria-label="Extend campaign"
        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
      >
        <CalendarPlus className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3 p-3">
        <div>
          <p className="text-sm font-medium text-foreground">Extend campaign</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Push the end date forward. Site bookings that ended on the
            current end date move with it.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`extend-${campaignId}`} className="text-xs">
            New end date
          </Label>
          <Input
            id={`extend-${campaignId}`}
            type="date"
            value={newEndDate}
            onChange={(e) => setNewEndDate(e.target.value)}
            min={currentEndDate ?? undefined}
            className="h-8 text-sm"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5"
            onClick={handleExtend}
            disabled={isPending}
          >
            {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            Extend
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
