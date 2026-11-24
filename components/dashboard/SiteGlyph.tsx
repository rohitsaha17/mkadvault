// SiteGlyph — a site's structure type on a small tile. Lit (accent) when the
// site is booked, unlit when it's open.
import { MediaGlyph } from "@/components/shared/MediaGlyph";
import { cn } from "@/lib/utils";

export function SiteGlyph({
  type,
  lit,
  className,
}: {
  type: string | null;
  lit: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-xl",
        lit
          ? "bg-primary/18 text-primary ring-1 ring-inset ring-primary/25"
          : "bg-muted text-muted-foreground",
        className,
      )}
    >
      <MediaGlyph type={type} className="size-5" />
    </span>
  );
}
