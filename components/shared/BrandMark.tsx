// BrandMark — the MK ADD VAULT logo tile.
// Used in the sidebar, auth screens and the generated PNG icons at
// /icon and /apple-icon. One source of truth so the mark stays in
// sync everywhere.
//
// Visual: a flat warm-ink tile with the wordmark "MK" and a row of
// three amber LED dots underneath. No gradient, no glow, no inner
// highlight. The dots are the only colour — they read as the lit
// panel of a hoarding at dusk.
import { cn } from "@/lib/utils";

interface BrandMarkProps {
  size?: number;
  className?: string;
}

export function BrandMark({ size = 36, className }: BrandMarkProps) {
  // Scale glyph + LED row with the tile so the mark is legible at 20px
  // (sidebar collapsed), 36px (sidebar expanded) and 512px (PWA).
  const radius = Math.round(size * 0.22);
  const fontSize = Math.round(size * 0.42);
  const dotSize = Math.max(1, Math.round(size * 0.06));
  const dotGap = Math.max(2, Math.round(size * 0.05));
  const dotRowBottom = Math.round(size * 0.14);

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
        // Flat warm-ink fill — slightly deeper than the sidebar so the
        // tile reads as its own object, with a hairline instead of a
        // ring.
        background: "oklch(0.26 0.014 55)",
        boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.06)",
      }}
    >
      <span
        className="relative text-white font-medium"
        style={{
          fontSize,
          lineHeight: 1,
          letterSpacing: "-0.03em",
          transform: `translateY(-${Math.round(size * 0.08)}px)`,
        }}
      >
        MK
      </span>

      {/* Three amber LED dots — the one spot of colour on the mark,
          tying the logo to the hoarding-vinyl accent. */}
      <div
        aria-hidden
        className="absolute left-0 right-0 flex items-center justify-center"
        style={{ bottom: dotRowBottom, gap: dotGap }}
      >
        <span
          className="rounded-full"
          style={{
            width: dotSize,
            height: dotSize,
            background: "oklch(0.74 0.14 55)",
          }}
        />
        <span
          className="rounded-full"
          style={{
            width: dotSize,
            height: dotSize,
            background: "oklch(0.74 0.14 55)",
          }}
        />
        <span
          className="rounded-full"
          style={{
            width: dotSize,
            height: dotSize,
            background: "oklch(0.74 0.14 55)",
          }}
        />
      </div>
    </div>
  );
}
