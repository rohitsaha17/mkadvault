// Campaign activity / audit timeline.
// Server component — receives pre-joined log rows (with actor profile)
// and renders them with a per-action icon, the actor's name/avatar
// initial, a relative timestamp, and an old → new diff when present.
//
// Keeping the lookup server-side (in the detail page's Promise.all)
// avoids a client-side round-trip and keeps the tab instant.

import { format, formatDistanceToNow } from "date-fns";
import {
  Activity,
  ArrowRight,
  ArrowRightLeft,
  CheckCircle2,
  FileText,
  IndianRupee,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Truck,
  User,
  XCircle,
} from "lucide-react";
import type { CampaignActivityAction } from "@/lib/types/database";

// Log row shape with the actor profile already joined in. The detail
// page does the Supabase join; we just render.
export interface ActivityEntry {
  id: string;
  created_at: string;
  action: CampaignActivityAction;
  description: string | null;
  old_value: string | null;
  new_value: string | null;
  actor: {
    id: string;
    full_name: string | null;
  } | null;
}

interface Props {
  entries: ActivityEntry[];
}

// Per-action icon + tailwind tint. Keeps the timeline scannable —
// greens are creations, reds are removals, blues are status/transitions.
const ICONS: Record<
  CampaignActivityAction,
  { Icon: typeof Activity; tone: string; label: string }
> = {
  created:           { Icon: Plus,           tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", label: "Created" },
  updated:           { Icon: Pencil,         tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300",             label: "Updated" },
  deleted:           { Icon: Trash2,         tone: "bg-rose-500/15 text-rose-700 dark:text-rose-300",           label: "Deleted" },
  status_changed:    { Icon: ArrowRightLeft, tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300",     label: "Status" },
  note_added:        { Icon: FileText,       tone: "bg-slate-500/15 text-slate-700 dark:text-slate-300",        label: "Note" },
  file_uploaded:     { Icon: FileText,       tone: "bg-slate-500/15 text-slate-700 dark:text-slate-300",        label: "File" },
  payment_received:  { Icon: IndianRupee,    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", label: "Payment" },
  site_added:        { Icon: MapPin,         tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", label: "Site" },
  site_removed:      { Icon: MapPin,         tone: "bg-rose-500/15 text-rose-700 dark:text-rose-300",          label: "Site" },
  service_added:     { Icon: Plus,           tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", label: "Service" },
  service_removed:   { Icon: Trash2,         tone: "bg-rose-500/15 text-rose-700 dark:text-rose-300",          label: "Service" },
  service_updated:   { Icon: Pencil,         tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300",             label: "Service" },
  job_added:         { Icon: Truck,          tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300",        label: "Job" },
  job_updated:       { Icon: Truck,          tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300",             label: "Job" },
  job_removed:       { Icon: Truck,          tone: "bg-rose-500/15 text-rose-700 dark:text-rose-300",          label: "Job" },
  change_requested:  { Icon: ArrowRight,     tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300",       label: "Change" },
  change_approved:   { Icon: CheckCircle2,   tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", label: "Change" },
  change_rejected:   { Icon: XCircle,        tone: "bg-rose-500/15 text-rose-700 dark:text-rose-300",           label: "Change" },
};

// Two-letter initials from a full name; falls back to "?" so the avatar
// circle never renders empty.
function initials(name?: string | null) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function CampaignActivityTimeline({ entries }: Props) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-10 text-center">
        <Activity className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Every edit, status change, and job action will appear here.
        </p>
      </div>
    );
  }

  return (
    <ol className="relative">
      {entries.map((e, i) => {
        const meta = ICONS[e.action] ?? {
          Icon: Activity,
          tone: "bg-muted text-muted-foreground",
          label: e.action,
        };
        const { Icon, tone, label } = meta;
        const actorName = e.actor?.full_name ?? "System";
        const isSystem = !e.actor;
        const isLast = i === entries.length - 1;
        const d = new Date(e.created_at);
        return (
          <li key={e.id} className="relative flex gap-4 pb-5">
            {/* Vertical rail */}
            {!isLast && (
              <span
                aria-hidden
                className="absolute left-[15px] top-8 bottom-0 w-px bg-border"
              />
            )}
            {/* Icon bubble */}
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-background ${tone}`}
              aria-hidden
            >
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {label}
                </span>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground"
                  title={isSystem ? "Automated system action" : actorName}
                >
                  {isSystem ? (
                    <User className="h-3 w-3 opacity-60" aria-hidden />
                  ) : (
                    <span
                      aria-hidden
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-[9px] font-semibold text-primary"
                    >
                      {initials(actorName)}
                    </span>
                  )}
                  <span className="truncate max-w-[140px]">
                    {isSystem ? "System" : actorName}
                  </span>
                </span>
              </div>
              <p className="mt-1 text-sm text-foreground">{e.description}</p>
              {e.old_value && e.new_value && (
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="rounded bg-rose-500/10 px-1.5 py-0.5 font-mono text-[11px] text-rose-700 dark:text-rose-300 line-through">
                    {e.old_value}
                  </span>
                  <ArrowRight className="h-3 w-3" aria-hidden />
                  <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[11px] text-emerald-700 dark:text-emerald-300">
                    {e.new_value}
                  </span>
                </p>
              )}
              <p
                className="mt-0.5 text-xs tabular-nums text-muted-foreground"
                title={format(d, "dd MMM yyyy, HH:mm:ss")}
              >
                {formatDistanceToNow(d, { addSuffix: true })}
                <span aria-hidden> · </span>
                {format(d, "dd MMM yyyy, HH:mm")}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
