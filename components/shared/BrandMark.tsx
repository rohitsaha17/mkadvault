// BrandMark — the MK ADD VAULT logo tile.
// Used in the sidebar, auth screens and the generated PNG icons at
// /icon and /apple-icon. One source of truth so the mark stays in
// sync everywhere.
//
// Visual: a warm-ink tile with a serif "MK" set in Instrument Serif,
// a brass hairline under the letters and a single brass dot above
// them — a quiet reference to the LED strip on a lit hoarding. No
// gradient, no glow. The serif + hairline detail does the work that
// a flashy logo tile usually does, more quietly.
import { cn } from "@/lib/utils";

interface BrandMarkProps {
  size?: number;
  className?: string;
}

export function BrandMark({ size = 36, className }: BrandMarkProps) {
  const radius = Math.round(size * 0.22);
  // Serif reads best at a slightly larger size relative to the tile.
  const fontSize = Math.round(size * 0.52);
  const underlineWidth = Math.round(size * 0.44);
  const underlineHeight = Math.max(1, Math.round(size * 0.025));
  const dotSize = Math.max(2, Math.round(size * 0.065));

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
        background: "oklch(0.24 0.012 55)",
        // Inner hairline rim — the "tile is a plate" effect, no glow.
        boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.07)",
      }}
    >
      {/* Single brass pip — the lit LED above the monogram. */}
      <span
        aria-hidden
        className="absolute rounded-full"
        style={{
          top: Math.round(size * 0.18),
          width: dotSize,
          height: dotSize,
          background: "oklch(0.78 0.145 65)",
          // Subtle warm inner highlight so the dot reads as a tiny
          // lit bulb rather than a pasted circle.
          boxShadow: "inset 0 0.5px 0 oklch(1 0 0 / 0.35)",
        }}
      />

      {/* MK monogram — Instrument Serif, drops slightly below optical
          centre so the dot and underline can breathe. */}
      <span
        className="relative text-white"
        style={{
          fontSize,
          lineHeight: 1,
          letterSpacing: "-0.015em",
          fontFamily: "var(--font-display), ui-serif, Georgia, serif",
          transform: `translateY(${Math.round(size * 0.03)}px)`,
        }}
      >
        MK
      </span>

      {/* Brass hairline underneath — the plate's signature. */}
      <span
        aria-hidden
        className="absolute"
        style={{
          bottom: Math.round(size * 0.2),
          width: underlineWidth,
          height: underlineHeight,
          background: "oklch(0.78 0.145 65)",
          opacity: 0.75,
        }}
      />
    </div>
  );
}
