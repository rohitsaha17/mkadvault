// StatusBadge — colour-coded badge for site/campaign/invoice/payable statuses.
// Uses semantic Tailwind classes with explicit dark-mode variants so the badge
// remains legible in both themes.
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Semantic colour buckets — one rule per tone so we only maintain a handful of
// class strings. Statuses map into a bucket below.
const TONE = {
  success:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30",
  // "live" is distinct from generic success — the campaign is earning
  // revenue right now. Brighter, more saturated green, plus a pulsing
  // dot via CSS animation to draw the eye.
  live:
    "bg-green-100 text-green-800 border-green-300 dark:bg-green-500/20 dark:text-green-200 dark:border-green-500/40",
  info:
    "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30",
  warning:
    "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
  danger:
    "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30",
  progress:
    "bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/30",
  accent:
    "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30",
  // "archived" — used for completed / dismounted states. Visually muted
  // so the eye slides over past campaigns and lingers on active ones.
  archived:
    "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/30",
  neutral:
    "bg-muted text-foreground border-border dark:bg-white/5 dark:text-muted-foreground dark:border-white/10",
} as const;

type Tone = keyof typeof TONE;

const STATUS_TONE: Record<string, Tone> = {
  // Site statuses
  available: "success",
  booked: "info",
  maintenance: "warning",
  blocked: "neutral",
  expired: "danger",
  // Campaign statuses — DB stores just three after migration 035.
  // "yet_to_start" is a display-only state derived from start_date so
  // edits to dates flip the badge without a write back to the DB.
  yet_to_start: "info",
  live: "live",
  completed: "archived",
  cancelled: "danger",
  // Invoice statuses
  draft: "neutral",
  sent: "info",
  partially_paid: "warning",
  paid: "success",
  overdue: "danger",
  // Payable statuses
  upcoming: "neutral",
  due: "warning",
  // Contract statuses
  active: "success",
  terminated: "danger",
  pending_renewal: "warning",
  // Expense / payment-request statuses (pending + approved are not covered
  // above; `paid` / `cancelled` / `rejected` already land on sensible tones)
  pending: "warning",
  approved: "info",
  rejected: "danger",
};

interface StatusBadgeProps {
  status: string;
  label?: string;
  className?: string;
  /** Show a subtle leading dot — good for dense tables */
  dot?: boolean;
}

function formatStatus(s: string) {
  return s
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function StatusBadge({ status, label, className, dot = true }: StatusBadgeProps) {
  const tone = STATUS_TONE[status] ?? "neutral";
  const classes = TONE[tone];
  // "Live" gets an animated pulsing dot so active campaigns really
  // feel active at a glance — matches real-world expectations for the
  // word "live".
  const isLive = status === "live";
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide",
        classes,
        className
      )}
    >
      {dot && (
        <span className="relative inline-flex h-1.5 w-1.5">
          {isLive && (
            <span
              aria-hidden
              className="absolute inline-flex h-full w-full rounded-full bg-current opacity-60 animate-ping"
            />
          )}
          <span
            aria-hidden
            className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current opacity-80"
          />
        </span>
      )}
      {label ?? formatStatus(status)}
    </Badge>
  );
}
