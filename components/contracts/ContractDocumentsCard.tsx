"use client";
// Contract detail — documents card. Shows the currently attached draft
// and signed copies, with buttons to upload/replace each. Signed URLs for
// viewing are fetched lazily on click so the server page doesn't need to
// generate them upfront.
import { useState, useTransition, useRef } from "react";
import { toast } from "sonner";
import { Loader2, Upload, FileText, FileSignature, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  uploadContractDocument,
  uploadSignedContract,
} from "@/app/[locale]/(dashboard)/contracts/actions";
import { createClient } from "@/lib/supabase/client";

interface Props {
  contractId: string;
  draftPath: string | null;
  signedPath: string | null;
}

export function ContractDocumentsCard({ contractId, draftPath, signedPath }: Props) {
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"draft" | "signed" | null>(null);
  const draftInputRef = useRef<HTMLInputElement>(null);
  const signedInputRef = useRef<HTMLInputElement>(null);

  function handleUpload(kind: "draft" | "signed", file: File | null) {
    if (!file) return;
    setBusy(kind);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("file", file);
      const res =
        kind === "draft"
          ? await uploadContractDocument(contractId, fd)
          : await uploadSignedContract(contractId, fd);
      setBusy(null);
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(
        kind === "draft" ? "Draft uploaded" : "Signed copy uploaded",
      );
    });
  }

  async function openFile(path: string) {
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from("contracts")
      .createSignedUrl(path, 60 * 5);
    if (error || !data?.signedUrl) {
      toast.error(error?.message ?? "Could not open file");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="rounded-2xl border border-border bg-card card-elevated p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Documents</h2>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Draft / template scan */}
        <DocRow
          label="Draft / template"
          icon={<FileText className="h-4 w-4" />}
          path={draftPath}
          busy={busy === "draft" || isPending}
          onPick={() => draftInputRef.current?.click()}
          onOpen={draftPath ? () => openFile(draftPath) : undefined}
        />
        <input
          ref={draftInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          className="hidden"
          onChange={(e) => {
            handleUpload("draft", e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />

        {/* Signed copy */}
        <DocRow
          label="Signed copy"
          icon={<FileSignature className="h-4 w-4" />}
          path={signedPath}
          busy={busy === "signed" || isPending}
          onPick={() => signedInputRef.current?.click()}
          onOpen={signedPath ? () => openFile(signedPath) : undefined}
        />
        <input
          ref={signedInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          className="hidden"
          onChange={(e) => {
            handleUpload("signed", e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        PDF, PNG or JPG up to 10 MB. The signed copy is the counter-signed
        agreement returned by the other party.
      </p>
    </section>
  );
}

function DocRow({
  label,
  icon,
  path,
  busy,
  onPick,
  onOpen,
}: {
  label: string;
  icon: React.ReactNode;
  path: string | null;
  busy: boolean;
  onPick: () => void;
  onOpen?: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      {path ? (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={onOpen}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={onPick}
            disabled={busy}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Replace
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={onPick}
          disabled={busy}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Upload {label.toLowerCase()}
        </Button>
      )}
    </div>
  );
}
