"use client";
// ImportFromFileDialog — lets a user upload another agency's PDF or PPTX
// rate card / proposal, have Claude Vision extract the site listings,
// review/edit the extracted rows, and then create the matching sites
// (copying the extracted photo across) and optionally pre-select them
// in the proposal wizard.
//
// Called from ProposalWizard Step 1 as:
//   <ImportFromFileDialog
//     onDone={(siteIds) => addToSelection(siteIds)}
//   />
//
// All heavy lifting happens server-side at /api/proposals/extract. This
// component is intentionally presentational + state-only.

import { useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import {
  FileUp,
  Loader2,
  Upload,
  ImageOff,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ImportSiteInput } from "@/app/[locale]/(dashboard)/sites/actions";
import { callAction } from "@/lib/utils/call-action";

// The raw shape we receive from /api/proposals/extract. Every field is
// optional because the AI may not find everything — the review UI lets
// the user fill in the gaps before saving.
interface ExtractedSite {
  name: string;
  site_code?: string | null;
  media_type?: string | null;
  structure_type?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  landmark?: string | null;
  width_ft?: number | null;
  height_ft?: number | null;
  illumination?: string | null;
  facing?: string | null;
  traffic_side?: string | null;
  visibility_distance_m?: number | null;
  base_rate_inr?: number | null;
  notes?: string | null;
  image_storage_path: string | null;
  image_signed_url: string | null;
}

// Internal review-row shape: ExtractedSite + selection flag and normalized
// required fields (defaults applied so zod validation on save can succeed
// even when the AI returned null).
interface ReviewRow extends ExtractedSite {
  selected: boolean;
  // Defaults so we can submit without forcing the user to touch every row.
  // They can still edit via the edit panel.
  media_type: ImportSiteInput["media_type"];
  structure_type: ImportSiteInput["structure_type"];
  illumination: ImportSiteInput["illumination"];
  traffic_side: ImportSiteInput["traffic_side"];
  width_ft: number;
  height_ft: number;
  address: string;
  city: string;
  state: string;
}

const MEDIA_TYPES = [
  "billboard", "hoarding", "dooh", "kiosk",
  "wall_wrap", "unipole", "bus_shelter", "custom",
] as const;
const ILLUMINATIONS = ["frontlit", "backlit", "digital", "nonlit"] as const;
const TRAFFIC_SIDES = ["lhs", "rhs", "both"] as const;
const STRUCTURE_TYPES = ["permanent", "temporary", "digital"] as const;

// Normalize an AI-returned string against a known enum. Falls back to the
// first value when we can't match — the review UI surfaces the default
// clearly so the user can correct it.
function pickEnum<T extends readonly string[]>(
  allowed: T,
  value: unknown,
  fallback: T[number]
): T[number] {
  if (typeof value !== "string") return fallback;
  const v = value.toLowerCase().trim().replace(/[\s-]/g, "_");
  return (allowed as readonly string[]).includes(v)
    ? (v as T[number])
    : fallback;
}

function toReviewRow(e: ExtractedSite): ReviewRow {
  return {
    ...e,
    selected: true,
    media_type: pickEnum(MEDIA_TYPES, e.media_type, "billboard"),
    structure_type: pickEnum(STRUCTURE_TYPES, e.structure_type, "permanent"),
    illumination: pickEnum(ILLUMINATIONS, e.illumination, "frontlit"),
    traffic_side: pickEnum(TRAFFIC_SIDES, e.traffic_side, "both"),
    width_ft: typeof e.width_ft === "number" && e.width_ft > 0 ? e.width_ft : 40,
    height_ft: typeof e.height_ft === "number" && e.height_ft > 0 ? e.height_ft : 20,
    address: e.address ?? "",
    city: e.city ?? "",
    state: e.state ?? "",
  };
}

interface Props {
  // Called with the list of newly-created site IDs once the user
  // confirms and the server has inserted them. The parent (wizard) uses
  // this to auto-add the imports into the current proposal selection.
  onDone?: (siteIds: string[]) => void;
}

export function ImportFromFileDialog({ onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"upload" | "review" | "saving">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [rows, setRows] = useState<ReviewRow[]>([]);

  function reset() {
    setStep("upload");
    setFile(null);
    setRows([]);
    setUploading(false);
  }

  async function handleExtract() {
    if (!file) return;
    // Two-step upload that bypasses Vercel's ~4.5 MB serverless body
    // cap (FUNCTION_PAYLOAD_TOO_LARGE / 413):
    //   1. Ask the server for a signed upload URL bound to a path
    //      under the user's org folder in site-photos.
    //   2. PUT the bytes straight to Supabase Storage. This goes
    //      direct to Supabase's host, so Vercel's body limit doesn't
    //      apply — files up to 50 MB sail through.
    //   3. POST the resulting filePath as a tiny JSON request to the
    //      extract endpoint, which downloads the bytes server-side
    //      and runs the AI extractor.
    setUploading(true);
    try {
      // ── 1. Get a signed upload URL ──────────────────────────────
      const initRes = await fetch("/api/proposals/extract/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          fileMime: file.type,
          fileSize: file.size,
        }),
      });
      const initBody = await initRes.text();
      let initJson: {
        error?: string;
        filePath?: string;
        signedUrl?: string;
        token?: string;
      } = {};
      try {
        initJson = initBody ? JSON.parse(initBody) : {};
      } catch {
        /* fall through */
      }
      if (!initRes.ok || !initJson.signedUrl || !initJson.filePath) {
        const excerpt = initBody.slice(0, 240).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        toast.error(
          initJson.error ??
            (excerpt ? `Couldn't start upload (${initRes.status}): ${excerpt}` : `Couldn't start upload (${initRes.status})`),
        );
        return;
      }

      // ── 2. Upload the file directly to Supabase Storage ─────────
      // The signed URL returned by Supabase wants a PUT with the
      // file's bytes as the body. Setting Content-Type matters so
      // the storage tier records the right MIME on the object.
      const putRes = await fetch(initJson.signedUrl, {
        method: "PUT",
        headers: { "content-type": file.type },
        body: file,
      });
      if (!putRes.ok) {
        toast.error(`Upload to storage failed (${putRes.status}). Try again.`);
        return;
      }

      // ── 3. Hand the path to the extract endpoint ────────────────
      const res = await fetch("/api/proposals/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filePath: initJson.filePath }),
      });
      const rawBody = await res.text();
      let json: { error?: string; sites?: ExtractedSite[] } = {};
      try {
        json = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        /* see below */
      }
      if (!res.ok) {
        const excerpt = rawBody
          ? rawBody.slice(0, 240).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
          : "";
        const message =
          json.error ??
          (excerpt
            ? `Extraction failed (${res.status}): ${excerpt}`
            : `Extraction failed (${res.status})`);
        toast.error(message);
        return;
      }
      const extracted = (json.sites ?? []) as ExtractedSite[];
      if (extracted.length === 0) {
        toast.message("No sites found in that file. Try a different one.");
        return;
      }
      setRows(extracted.map(toReviewRow));
      setStep("review");
    } catch (err) {
      // True network / abort failure — the fetch never got a response.
      console.error("[import] fetch failed:", err);
      const detail = err instanceof Error ? err.message : String(err);
      toast.error(`Upload failed: ${detail}. Check your connection or try a smaller file.`);
    } finally {
      setUploading(false);
    }
  }

  function updateRow(idx: number, patch: Partial<ReviewRow>) {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...patch } : r))
    );
  }

  async function handleSave() {
    const selected = rows.filter((r) => r.selected);
    if (selected.length === 0) {
      toast.error("Select at least one site to import");
      return;
    }
    // Client-side required-field check — server validates again.
    const invalid = selected.find(
      (r) => !r.name?.trim() || !r.address?.trim() || !r.city?.trim() || !r.state?.trim()
    );
    if (invalid) {
      toast.error(`Fill name, address, city, state for "${invalid.name || "untitled"}"`);
      return;
    }

    setStep("saving");
    const payload: ImportSiteInput[] = selected.map((r) => ({
      name: r.name.trim(),
      site_code: r.site_code?.trim() || null,
      media_type: r.media_type,
      structure_type: r.structure_type,
      address: r.address.trim(),
      city: r.city.trim(),
      state: r.state.trim(),
      pincode: r.pincode?.trim() || null,
      landmark: r.landmark?.trim() || null,
      width_ft: r.width_ft,
      height_ft: r.height_ft,
      illumination: r.illumination,
      facing: (r.facing as ImportSiteInput["facing"]) ?? null,
      traffic_side: r.traffic_side,
      visibility_distance_m:
        typeof r.visibility_distance_m === "number" ? r.visibility_distance_m : null,
      base_rate_inr: typeof r.base_rate_inr === "number" ? r.base_rate_inr : null,
      notes: r.notes?.trim() || null,
      image_storage_path: r.image_storage_path,
    }));

    type ImportResult = {
      error?: string;
      createdSiteIds?: string[];
      errors?: { siteIdx: number; message: string }[];
    };
    const result = await callAction<ImportResult>(
      "createSitesFromImport",
      payload,
    );
    if (result.error) {
      toast.error(result.error);
      setStep("review");
      return;
    }

    const createdIds = result.createdSiteIds ?? [];
    const errs = result.errors ?? [];
    if (errs.length > 0) {
      toast.error(
        `${createdIds.length} created, ${errs.length} failed. First error: ${errs[0].message}`,
      );
    } else {
      toast.success(`${createdIds.length} site${createdIds.length === 1 ? "" : "s"} imported`);
    }

    onDone?.(createdIds);
    setOpen(false);
    reset();
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-2"
      >
        <FileUp className="h-4 w-4" />
        Import from PDF/PPTX
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogTitle>Import sites from another agency&apos;s deck</DialogTitle>
          <DialogDescription>
            Upload a PDF or PPTX rate card — our AI will extract each site&apos;s
            photo and details. Review the rows, tweak anything wrong, then
            save them as new sites in your inventory.
          </DialogDescription>

          {/* Upload step */}
          {step === "upload" && (
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-lg py-12 px-6 gap-4">
              <Upload className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground text-center max-w-md">
                Accepted: PDF, PPTX (up to 50 MB). Works best with decks that
                have one site per slide/page with a photo + details.
              </p>
              <div className="flex flex-col items-stretch gap-2 w-full max-w-sm">
                <Input
                  type="file"
                  accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {file && (
                  <p className="text-xs text-muted-foreground truncate">
                    {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                )}
                <Button
                  type="button"
                  onClick={handleExtract}
                  disabled={!file || uploading}
                  className="gap-2"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Reading file… (can take up to a minute)
                    </>
                  ) : (
                    <>
                      <FileUp className="h-4 w-4" />
                      Extract sites
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Review step */}
          {step === "review" && (
            <>
              <div className="flex items-center justify-between py-2 text-sm">
                <span>
                  {rows.filter((r) => r.selected).length} of {rows.length} selected
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setRows((prev) => prev.map((r) => ({ ...r, selected: true })))
                    }
                  >
                    Select all
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setRows((prev) => prev.map((r) => ({ ...r, selected: false })))
                    }
                  >
                    Deselect all
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {rows.map((row, idx) => (
                  <ReviewCard
                    key={idx}
                    row={row}
                    onChange={(patch) => updateRow(idx, patch)}
                  />
                ))}
              </div>

              <div className="flex items-center justify-between pt-3 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={reset}
                >
                  ← Upload different file
                </Button>
                <Button type="button" size="sm" onClick={handleSave}>
                  Import {rows.filter((r) => r.selected).length} site
                  {rows.filter((r) => r.selected).length === 1 ? "" : "s"}
                </Button>
              </div>
            </>
          )}

          {/* Saving step */}
          {step === "saving" && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Creating sites…</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Row renderer — one card per extracted site.

function ReviewCard({
  row,
  onChange,
}: {
  row: ReviewRow;
  onChange: (patch: Partial<ReviewRow>) => void;
}) {
  const hasAllRequired = row.name.trim() && row.address.trim() && row.city.trim() && row.state.trim();

  return (
    <div
      className={`border rounded-lg p-3 transition-colors ${
        row.selected ? "border-primary/50 bg-primary/5" : "border-border"
      }`}
    >
      <div className="flex gap-3">
        {/* Thumbnail */}
        <div className="relative h-24 w-32 shrink-0 overflow-hidden rounded-md border bg-muted">
          {row.image_signed_url ? (
            <Image
              src={row.image_signed_url}
              alt={row.name}
              fill
              className="object-cover"
              sizes="128px"
              unoptimized
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <ImageOff className="h-5 w-5" />
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={row.selected}
                onChange={(e) => onChange({ selected: e.target.checked })}
                className="accent-primary h-4 w-4"
              />
              <span className="text-sm font-medium">
                {row.name || "(no name found)"}
              </span>
              {hasAllRequired ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <XCircle className="h-4 w-4 text-amber-500" />
              )}
            </label>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <Field label="Name">
              <Input
                value={row.name}
                onChange={(e) => onChange({ name: e.target.value })}
                className="h-8 text-xs"
              />
            </Field>
            <Field label="City">
              <Input
                value={row.city}
                onChange={(e) => onChange({ city: e.target.value })}
                className="h-8 text-xs"
              />
            </Field>
            <Field label="State">
              <Input
                value={row.state}
                onChange={(e) => onChange({ state: e.target.value })}
                className="h-8 text-xs"
              />
            </Field>
            <Field label="Pincode">
              <Input
                value={row.pincode ?? ""}
                onChange={(e) => onChange({ pincode: e.target.value })}
                className="h-8 text-xs"
              />
            </Field>
            <Field label="Address" className="col-span-2 sm:col-span-4">
              <Input
                value={row.address}
                onChange={(e) => onChange({ address: e.target.value })}
                className="h-8 text-xs"
              />
            </Field>
            <Field label="Media type">
              <select
                value={row.media_type}
                onChange={(e) =>
                  onChange({ media_type: e.target.value as ReviewRow["media_type"] })
                }
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
              >
                {MEDIA_TYPES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Illumination">
              <select
                value={row.illumination}
                onChange={(e) =>
                  onChange({
                    illumination: e.target.value as ReviewRow["illumination"],
                  })
                }
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
              >
                {ILLUMINATIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="W (ft)">
              <Input
                type="number"
                value={row.width_ft}
                onChange={(e) =>
                  onChange({ width_ft: parseFloat(e.target.value) || 0 })
                }
                className="h-8 text-xs"
              />
            </Field>
            <Field label="H (ft)">
              <Input
                type="number"
                value={row.height_ft}
                onChange={(e) =>
                  onChange({ height_ft: parseFloat(e.target.value) || 0 })
                }
                className="h-8 text-xs"
              />
            </Field>
            <Field label="Traffic side">
              <select
                value={row.traffic_side ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  onChange({
                    traffic_side: v === ""
                      ? null
                      : (v as Exclude<ReviewRow["traffic_side"], null | undefined>),
                  });
                }}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="">— Optional —</option>
                {TRAFFIC_SIDES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Rate ₹/mo">
              <Input
                type="number"
                value={row.base_rate_inr ?? ""}
                onChange={(e) =>
                  onChange({
                    base_rate_inr: e.target.value
                      ? parseFloat(e.target.value)
                      : null,
                  })
                }
                className="h-8 text-xs"
              />
            </Field>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-[10px] uppercase text-muted-foreground mb-0.5 block">
        {label}
      </Label>
      {children}
    </div>
  );
}
