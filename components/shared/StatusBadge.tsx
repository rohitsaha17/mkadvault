// StatusBadge — colour-coded badge for site/campaign/invoice/payable statuses.
// Uses semantic Tailwind classes with explicit dark-mode variants so the badge
// remains legible in both themes.
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Semantic colour buckets. Each is a soft tint with readable text in both
// themes; "live" is the one solid chip because it means earning right now.
// Colour never carries the meaning alone — the label is always there.
const TONE = {
  success:
    "bg-emerald-500/12 text-emerald-800 border-emerald-600/25 dark:text-emerald-300 dark:border-emerald-400/25",
  live: "bg-primary text-primary-foreground border-transparent font-semibold",
  info: "bg-sky-500/12 text-sky-800 border-sky-600/25 dark:text-sky-300 dark:border-sky-400/25",
  warning:
    "bg-amber-500/15 text-amber-900 border-amber-600/30 dark:text-amber-300 dark:border-amber-400/25",
  danger:
    "bg-rose-500/12 text-rose-800 border-rose-600/25 dark:text-rose-300 dark:border-rose-400/25",
  archived: "bg-muted text-muted-foreground border-border",
  neutral: "bg-muted text-foreground border-border",
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
  /** Sits on a photograph: use a dark frosted chip so it stays readable */
  onPhoto?: boolean;
}

function formatStatus(s: string) {
  return s
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function StatusBadge({
  status,
  label,
  className,
  dot = true,
  onPhoto = false,
}: StatusBadgeProps) {
  const tone = STATUS_TONE[status] ?? "neutral";
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
        TONE[tone],
        onPhoto &&
          "border-white/20 bg-black/55 text-white backdrop-blur-md dark:border-white/20 dark:text-white",
        className
      )}
    >
      {dot && (
        <span
          aria-hidden
          className="inline-flex size-1.5 shrink-0 rounded-full bg-current"
        />
      )}
      {label ?? formatStatus(status)}
    </Badge>
  );
}
