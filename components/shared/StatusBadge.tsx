// StatusBadge — colour-coded badge for site/campaign/invoice/payable statuses.
// Uses semantic Tailwind classes with explicit dark-mode variants so the badge
// remains legible in both themes.
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Semantic colour buckets — tuned to sit inside the warm-ink palette.
// Each tone uses a muted surface step plus a leading status dot that
// carries the colour. The dot does the semantic work; the chip itself
// stays quiet so a dense table of statuses doesn't turn into confetti.
const TONE = {
  success:
    "bg-muted/60 text-foreground border-border/60",
  live:
    "bg-primary/10 text-foreground border-primary/30",
  info:
    "bg-muted/60 text-foreground border-border/60",
  warning:
    "bg-muted/60 text-foreground border-border/60",
  danger:
    "bg-destructive/10 text-foreground border-destructive/30",
  progress:
    "bg-muted/60 text-foreground border-border/60",
  accent:
    "bg-primary/10 text-foreground border-primary/30",
  archived:
    "bg-muted/40 text-muted-foreground border-border/40",
  neutral:
    "bg-muted/50 text-muted-foreground border-border/50",
} as const;

// Status dot colours — these are the one spot of hue, tiny and precise
// so meaning is preserved without the whole chip shouting.
const DOT: Record<keyof typeof TONE, string> = {
  success: "bg-emerald-500",
  live: "bg-primary",
  info: "bg-muted-foreground",
  warning: "bg-amber-500",
  danger: "bg-destructive",
  progress: "bg-muted-foreground",
  accent: "bg-primary",
  archived: "bg-muted-foreground/60",
  neutral: "bg-muted-foreground/60",
};

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
  const dotClass = DOT[tone];
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-normal",
        classes,
        className
      )}
    >
      {dot && (
        <span
          aria-hidden
          className={cn("inline-flex h-1.5 w-1.5 rounded-full shrink-0", dotClass)}
        />
      )}
      {label ?? formatStatus(status)}
    </Badge>
  );
}
