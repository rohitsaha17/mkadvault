// SiteCode — the hoarding's ID, like the plate screwed to its frame.
import { cn } from "@/lib/utils";

export function SiteCode({
  code,
  className,
}: {
  code: string | null;
  className?: string;
}) {
  if (!code) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md bg-foreground/7 px-1.5 py-0.5 font-mono text-[11px] leading-none text-muted-foreground",
        className,
      )}
    >
      {code}
    </span>
  );
}
