"use client";
// One row of the signed-agreements list. Handles "View" (signed URL) and
// soft-delete. Kept as a small client component so the list page can stay
// a server component.
import { useTransition } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ExternalLink, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { deleteSignedAgreement } from "@/app/[locale]/(dashboard)/contracts/actions";

interface Props {
  id: string;
  title: string;
  subtitle: string;
  agreementDate: string | null;
  documentUrl: string;
}

export function SignedAgreementRow({
  id,
  title,
  subtitle,
  agreementDate,
  documentUrl,
}: Props) {
  const [isPending, startTransition] = useTransition();

  async function openFile() {
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from("contracts")
      .createSignedUrl(documentUrl, 60 * 5);
    if (error || !data?.signedUrl) {
      toast.error(error?.message ?? "Could not open file");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  function handleDelete() {
    if (!window.confirm(`Delete "${title}"? The uploaded file will stay in storage but the record will be removed.`)) return;
    startTransition(async () => {
      const res = await deleteSignedAgreement(id);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Agreement deleted");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground truncate">{title}</p>
        <p className="text-xs text-muted-foreground truncate">
          {subtitle}
          {agreementDate ? (
            <>
              {subtitle && " · "}
              Dated {format(new Date(agreementDate), "dd MMM yyyy")}
            </>
          ) : null}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={openFile}
      >
        <ExternalLink className="h-3.5 w-3.5" />
        View
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground hover:text-destructive"
        onClick={handleDelete}
        disabled={isPending}
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
        Delete
      </Button>
    </div>
  );
}
