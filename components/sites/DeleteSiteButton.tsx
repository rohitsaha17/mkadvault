"use client";
// DeleteSiteButton — triggers soft-delete with a confirmation dialog.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { callAction } from "@/lib/utils/call-action";

interface Props {
  siteId: string;
  siteName: string;
  // If true, redirect to /sites after delete (used from detail page)
  redirectAfter?: boolean;
}

export function DeleteSiteButton({ siteId, siteName, redirectAfter }: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleDelete() {
    startTransition(async () => {
      try {
        const result = await callAction<{ error?: string }>("deleteSite", siteId);
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success("Site deleted");
        setOpen(false);
        if (redirectAfter) {
          router.push("/sites");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Delete failed");
      }
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-red-500 hover:text-red-600 hover:bg-red-50"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4" />
        <span className="sr-only">Delete</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Site?</DialogTitle>
            <DialogDescription>
              Archive <strong>{siteName}</strong>? The site will be hidden but can
              be restored by an admin. This does not affect existing bookings.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isPending}
            >
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
