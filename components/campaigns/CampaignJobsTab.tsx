"use client";
// Campaign Jobs tab — print / mount / repair work tracked per campaign.
// Lists existing jobs and lets authorised users add, complete, or
// delete them. External jobs with a cost can optionally spawn a linked
// payment request in the Finance module at creation time.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Plus,
  Printer,
  Wrench,
  CheckCircle2,
  Trash2,
  X,
  Loader2,
  ExternalLink,
  Home,
  Building2,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { inr, fmt, cn } from "@/lib/utils";
import type {
  CampaignJob,
  CampaignJobType,
  CampaignJobStatus,
} from "@/lib/types/database";

// ─── Types passed from the server component ──────────────────────────────
interface SiteOption {
  campaign_site_id: string; // campaign_sites.id
  site_id: string;
  site_name: string;
  site_code: string | null;
}

interface AgencyOption {
  id: string;
  agency_name: string;
}

interface Props {
  campaignId: string;
  jobs: CampaignJob[];
  siteOptions: SiteOption[];
  agencyOptions: AgencyOption[];
  canEdit: boolean;
}

const JOB_TYPE_LABEL: Record<CampaignJobType, string> = {
  print: "Print",
  mount: "Mount",
  print_and_mount: "Print + Mount",
  unmount: "Unmount",
  repair: "Repair",
  other: "Other",
};

const JOB_TYPE_ICON: Record<CampaignJobType, React.ComponentType<{ className?: string }>> = {
  print: Printer,
  mount: Wrench,
  print_and_mount: Wrench,
  unmount: Wrench,
  repair: Wrench,
  other: Wrench,
};

// ─── Tab component ────────────────────────────────────────────────────────
export function CampaignJobsTab({
  campaignId,
  jobs: initialJobs,
  siteOptions,
  agencyOptions,
  canEdit,
}: Props) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initialJobs);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  // ── Row actions ────────────────────────────────────────────────────────
  function handleMarkComplete(job: CampaignJob) {
    setBusyId(job.id);
    startTransition(async () => {
      try {
        const res = await fetch("/api/campaign-jobs", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ id: job.id, status: "completed" }),
        });
        const data = await res.json().catch(() => ({}));
        if (data?.error) {
          toast.error(data.error);
          return;
        }
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? {
                  ...j,
                  status: "completed" as CampaignJobStatus,
                  completed_date: data.job?.completed_date ?? j.completed_date,
                }
              : j,
          ),
        );
        toast.success("Job marked complete");
        router.refresh();
      } finally {
        setBusyId(null);
      }
    });
  }

  function handleDelete(job: CampaignJob) {
    if (!confirm(`Delete job "${job.description}"? This can't be undone.`)) return;
    setBusyId(job.id);
    startTransition(async () => {
      try {
        const res = await fetch("/api/campaign-jobs", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ id: job.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (data?.error) {
          toast.error(data.error);
          return;
        }
        setJobs((prev) => prev.filter((j) => j.id !== job.id));
        toast.success("Job deleted");
        router.refresh();
      } finally {
        setBusyId(null);
      }
    });
  }

  // ── Empty state ────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Print, mounting, and repair work for this campaign. Outsourced
          jobs can raise a payment request to the Finance team in one step.
        </p>
        {canEdit && (
          <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Add Job
          </Button>
        )}
      </div>

      {jobs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-10 text-center">
          <Printer className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">
            No jobs yet for this campaign.
          </p>
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => setDialogOpen(true)}
            >
              Add the first job
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Job</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Site</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Source / Vendor</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Scheduled</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Cost</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                <th className="w-32 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {jobs.map((job) => {
                const Icon = JOB_TYPE_ICON[job.job_type];
                const site = siteOptions.find((s) => s.campaign_site_id === job.campaign_site_id);
                const isBusy = busyId === job.id;
                return (
                  <tr key={job.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                        <div className="min-w-0">
                          <p className="font-medium text-foreground leading-tight">
                            {JOB_TYPE_LABEL[job.job_type]}
                          </p>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {job.description}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {site ? (
                        <>
                          <p>{site.site_name}</p>
                          {site.site_code && (
                            <p className="font-mono text-[10px] text-muted-foreground/70">
                              {site.site_code}
                            </p>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground/60">Campaign-wide</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {job.source === "internal" ? (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Home className="h-3 w-3" />
                          Internal
                        </span>
                      ) : (
                        <div>
                          <span className="inline-flex items-center gap-1 text-foreground">
                            <Building2 className="h-3 w-3" />
                            {job.vendor_name || "External vendor"}
                          </span>
                          {job.vendor_contact && (
                            <p className="text-[11px] text-muted-foreground">{job.vendor_contact}</p>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {job.scheduled_date ? fmt(job.scheduled_date) : "—"}
                      {job.completed_date && (
                        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                          Done {fmt(job.completed_date)}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {job.cost_paise ? (
                        <>
                          <p className="font-medium text-foreground">{inr(job.cost_paise)}</p>
                          {job.expense_id && (
                            <Link
                              href={`/finance/requests`}
                              className="text-[11px] text-primary hover:underline inline-flex items-center gap-0.5"
                            >
                              Payment req
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                        {canEdit && job.status !== "completed" && job.status !== "cancelled" && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Mark complete"
                            title="Mark complete"
                            disabled={isBusy}
                            onClick={() => handleMarkComplete(job)}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          </Button>
                        )}
                        {canEdit && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Delete"
                            title="Delete"
                            disabled={isBusy}
                            onClick={() => handleDelete(job)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Job dialog */}
      {dialogOpen && (
        <AddJobDialog
          campaignId={campaignId}
          siteOptions={siteOptions}
          agencyOptions={agencyOptions}
          onClose={() => setDialogOpen(false)}
          onCreated={(job) => {
            setJobs((prev) => [...prev, job]);
            setDialogOpen(false);
            router.refresh();
          }}
          isPending={isPending}
          startTransition={startTransition}
        />
      )}
    </div>
  );
}

// ─── Add Job Dialog ───────────────────────────────────────────────────────
function AddJobDialog({
  campaignId,
  siteOptions,
  agencyOptions,
  onClose,
  onCreated,
  isPending,
  startTransition,
}: {
  campaignId: string;
  siteOptions: SiteOption[];
  agencyOptions: AgencyOption[];
  onClose: () => void;
  onCreated: (job: CampaignJob) => void;
  isPending: boolean;
  startTransition: (fn: () => Promise<void> | void) => void;
}) {
  const [jobType, setJobType] = useState<CampaignJobType>("print");
  const [source, setSource] = useState<"internal" | "external">("internal");
  const [campaignSiteId, setCampaignSiteId] = useState<string>("");
  const [scheduledDate, setScheduledDate] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [vendorName, setVendorName] = useState<string>("");
  const [vendorContact, setVendorContact] = useState<string>("");
  const [vendorAgencyId, setVendorAgencyId] = useState<string>("");
  const [costRupees, setCostRupees] = useState<string>("");
  const [autoRaise, setAutoRaise] = useState<boolean>(true);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) {
      toast.error("Description is required");
      return;
    }
    const selectedSite = siteOptions.find((s) => s.campaign_site_id === campaignSiteId);

    const payload = {
      campaign_id: campaignId,
      campaign_site_id: campaignSiteId || null,
      site_id: selectedSite?.site_id ?? null,
      job_type: jobType,
      source,
      description: description.trim(),
      notes: notes.trim() || null,
      scheduled_date: scheduledDate || null,
      vendor_name: source === "external" ? vendorName.trim() || null : null,
      vendor_contact: source === "external" ? vendorContact.trim() || null : null,
      vendor_agency_id: source === "external" && vendorAgencyId ? vendorAgencyId : null,
      cost_rupees:
        source === "external" && costRupees && Number(costRupees) > 0
          ? Number(costRupees)
          : null,
      auto_raise_payment_request:
        source === "external" && autoRaise && Number(costRupees) > 0,
    };

    startTransition(async () => {
      const res = await fetch("/api/campaign-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      if (data?.warning) toast.message(data.warning);
      toast.success(
        data?.expense_id
          ? "Job created + payment request raised"
          : "Job created",
      );
      onCreated(data.job as CampaignJob);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-2 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl sm:max-h-[calc(100dvh-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-card px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Add campaign job</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Track print / mounting work, internal or outsourced.
            </p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col text-sm">
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {/* Type + Source */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Job type</Label>
                <select
                  value={jobType}
                  onChange={(e) => setJobType(e.target.value as CampaignJobType)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {(Object.keys(JOB_TYPE_LABEL) as CampaignJobType[]).map((k) => (
                    <option key={k} value={k}>
                      {JOB_TYPE_LABEL[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Done by</Label>
                <div className="grid grid-cols-2 gap-1 rounded-md border border-input p-0.5">
                  <button
                    type="button"
                    onClick={() => setSource("internal")}
                    className={cn(
                      "rounded px-3 py-1.5 text-xs font-medium transition",
                      source === "internal"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    Internal
                  </button>
                  <button
                    type="button"
                    onClick={() => setSource("external")}
                    className={cn(
                      "rounded px-3 py-1.5 text-xs font-medium transition",
                      source === "external"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    External vendor
                  </button>
                </div>
              </div>
            </div>

            {/* Site */}
            <div className="space-y-1.5">
              <Label className="text-xs">
                Site{" "}
                <span className="text-muted-foreground font-normal">
                  (leave blank for campaign-wide)
                </span>
              </Label>
              <select
                value={campaignSiteId}
                onChange={(e) => setCampaignSiteId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Campaign-wide (no specific site)</option>
                {siteOptions.map((s) => (
                  <option key={s.campaign_site_id} value={s.campaign_site_id}>
                    {s.site_name}
                    {s.site_code ? ` (${s.site_code})` : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label className="text-xs">
                Description <span className="text-destructive">*</span>
              </Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Flex printing for 30×30 hoarding, Apr 2026"
                required
                maxLength={300}
              />
            </div>

            {/* Scheduled date */}
            <div className="space-y-1.5">
              <Label className="text-xs">Scheduled date</Label>
              <Input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
              />
            </div>

            {/* External-only fields */}
            {source === "external" && (
              <div className="space-y-4 rounded-lg border border-dashed border-border p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Vendor details
                </p>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Vendor name</Label>
                    <Input
                      value={vendorName}
                      onChange={(e) => setVendorName(e.target.value)}
                      placeholder="e.g. Sharma Printers"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Contact (phone / email)</Label>
                    <Input
                      value={vendorContact}
                      onChange={(e) => setVendorContact(e.target.value)}
                      placeholder="+91 98XXXXXXXX"
                    />
                  </div>
                </div>

                {agencyOptions.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      Or pick a known agency{" "}
                      <span className="text-muted-foreground font-normal">(optional)</span>
                    </Label>
                    <select
                      value={vendorAgencyId}
                      onChange={(e) => setVendorAgencyId(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="">—</option>
                      {agencyOptions.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.agency_name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs">Cost (₹)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={costRupees}
                    onChange={(e) => setCostRupees(e.target.value)}
                    placeholder="0.00"
                  />
                </div>

                {Number(costRupees) > 0 && (
                  <label className="flex cursor-pointer items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={autoRaise}
                      onChange={(e) => setAutoRaise(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-input"
                    />
                    <span className="text-muted-foreground">
                      Also raise a{" "}
                      <span className="font-medium text-foreground">payment request</span>{" "}
                      to Finance for ₹{Number(costRupees).toLocaleString("en-IN")} — accounts
                      will see it in Finance → Approvals and can approve + pay the vendor.
                    </span>
                  </label>
                )}
              </div>
            )}

            {/* Notes */}
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any internal notes…"
                maxLength={1000}
              />
            </div>
          </div>

          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-card px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} className="gap-1.5">
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create job
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
