"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { duplicateProposal, deleteProposal } from "@/app/[locale]/(dashboard)/proposals/actions";

interface Props {
  proposalId: string;
  proposalName: string;
}

export function ProposalActions({ proposalId, proposalName }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleDuplicate() {
    startTransition(async () => {
      const result = await duplicateProposal(proposalId);
      if (result.error) { toast.error(result.error); return; }
      toast.success("Proposal duplicated");
      if (result.id) router.push(`/proposals/${result.id}/edit`);
    });
  }

  function handleDelete() {
    if (!confirm(`Delete "${proposalName}"? This cannot be undone.`)) return;
    startTransition(async () => {
      const result = await deleteProposal(proposalId);
      if (result.error) { toast.error(result.error); return; }
      toast.success("Proposal deleted");
      router.push("/proposals");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" onClick={handleDuplicate} disabled={isPending} title="Duplicate">
        <Copy className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="sm" onClick={handleDelete} disabled={isPending}
        className="text-destructive hover:text-destructive hover:bg-destructive/10" title="Delete">
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
