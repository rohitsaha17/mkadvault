// BrandMark — the MK ADD VAULT logo tile.
// A single visual used everywhere the app brands itself: the sidebar
// (desktop + mobile), the auth screens, and the generated PNG icons
// at /icon and /apple-icon. Keeping one source of truth means the
// mark stays in sync if we ever change the colour palette or glyph.
//
// Visual: a rounded-square tile with an indigo→navy diagonal
// gradient, a soft inner highlight, and a bold white "MK" letterform
// paired with a tiny dot-matrix accent that nods to a billboard LED
// panel + the "VAULT" idea (secure, central). No raster image; pure
// CSS + an inline SVG so it stays crisp at any size and themes
// correctly in dark mode.
import { cn } from "@/lib/utils";

interface BrandMarkProps {
  size?: number;
  className?: string;
}

export function BrandMark({ size = 36, className }: BrandMarkProps) {
  // Scale font + accent dots with the tile so the mark is legible at
  // 20px (sidebar collapsed), 36px (sidebar expanded) and 512px (PWA).
  const radius = Math.round(size * 0.22);
  const fontSize = Math.round(size * 0.44);
  const dotSize = Math.max(1, Math.round(size * 0.06));
  const dotGap = Math.max(1, Math.round(size * 0.035));
  const dotRowBottom = Math.round(size * 0.14);

  return (
    <div
      aria-label="MK ADD VAULT"
      role="img"
      className={cn(
        "relative shrink-0 flex items-center justify-center overflow-hidden",
        "shadow-[0_6px_18px_-6px_rgba(79,70,229,0.55)] ring-1 ring-white/15",
        className,
      )}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background:
          "linear-gradient(135deg,#312E81 0%,#4F46E5 45%,#1E293B 100%)",
      }}
    >
      {/* Soft top-left highlight — gives the tile a bit of depth so it
          doesn't look flat beside the rest of the app chrome. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 60% at 20% 0%, rgba(255,255,255,0.22), transparent 60%)",
          borderRadius: radius,
        }}
      />

      {/* MK letterform — tight tracking, high-weight so the two letters
          read as a single glyph rather than two characters. */}
      <span
        className="relative font-extrabold text-white"
        style={{
          fontSize,
          lineHeight: 1,
          letterSpacing: "-0.04em",
          // Move the letters up slightly to leave room for the LED-dot
          // row at the bottom — a tiny visual nod to a billboard.
          transform: `translateY(-${Math.round(size * 0.06)}px)`,
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        }}
      >
        MK
      </span>

      {/* Dot-matrix accent row — three dots sit under the letters like
          an LED strip. Subtle, but makes the mark feel OOH-specific
          rather than generic finance/SaaS. */}
      <div
        aria-hidden
        className="absolute left-0 right-0 flex items-center justify-center"
        style={{ bottom: dotRowBottom, gap: dotGap }}
      >
        <span
          className="rounded-full bg-amber-300/90"
          style={{ width: dotSize, height: dotSize }}
        />
        <span
          className="rounded-full bg-white/80"
          style={{ width: dotSize, height: dotSize }}
        />
        <span
          className="rounded-full bg-amber-300/90"
          style={{ width: dotSize, height: dotSize }}
        />
      </div>
    </div>
  );
}
