// BrandMark — the MK ADD VAULT logo tile.
// Used in the sidebar, auth screens and the generated PNG icons at
// /icon and /apple-icon.
//
// Visual: a flat lime tile with deep-ink "MK" wordmark. Matches the
// safety-vest / electric-accent direction of the dashboard. No
// gradient, no glow — the saturated lime does the work.
import { cn } from "@/lib/utils";

interface BrandMarkProps {
  size?: number;
  className?: string;
}

export function BrandMark({ size = 36, className }: BrandMarkProps) {
  const radius = Math.round(size * 0.24);
  const fontSize = Math.round(size * 0.44);

  return (
    <div
      aria-label="MK ADD VAULT"
      role="img"
      className={cn(
        "relative shrink-0 flex items-center justify-center overflow-hidden",
        className,
      )}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: "oklch(0.9 0.21 128)",
      }}
    >
      <span
        className="font-semibold"
        style={{
          fontSize,
          lineHeight: 1,
          letterSpacing: "-0.04em",
          color: "oklch(0.14 0 0)",
        }}
      >
        MK
      </span>
    </div>
  );
}
