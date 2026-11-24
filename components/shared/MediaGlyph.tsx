// MediaGlyph — a small line drawing of each kind of advertising structure.
// Drawn for this app because icon libraries don't know a unipole from a
// hoarding. 24 x 24 grid, 1.6 stroke, inherits the text colour.
import type { MediaType } from "@/lib/types/database";

const SHAPES: Record<MediaType, React.ReactNode> = {
  // Wide panel on two posts, lamps on top.
  hoarding: (
    <>
      <rect x="3" y="6.5" width="18" height="8.5" rx="1.2" />
      <path d="M7.5 15v6M16.5 15v6M5 21h5M14 21h5M8 6.5V4h2M14 6.5V4h2" />
    </>
  ),
  // Panel on one post with a catwalk underneath.
  billboard: (
    <>
      <rect x="3" y="4" width="18" height="9" rx="1.2" />
      <path d="M5 15.5h14M12 15.5V21M9 21h6" />
    </>
  ),
  // High panel on a thick single column.
  unipole: (
    <>
      <rect x="2.5" y="3" width="19" height="8" rx="1.2" />
      <path d="M10.7 11v10M13.3 11v10M8 21h8" />
    </>
  ),
  // Digital screen: lit pixels.
  dooh: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="1.8" />
      <path d="M12 16v4.5M8.5 20.5h7" />
      <path
        d="M7.5 8h.01M12 8h.01M16.5 8h.01M7.5 12h.01M12 12h.01M16.5 12h.01"
        strokeWidth="2.4"
      />
    </>
  ),
  kiosk: (
    <>
      <rect x="7" y="2.5" width="10" height="15" rx="2" />
      <path d="M10 6.5h4M10 9.5h4M12 17.5v3.5M8 21h8" />
    </>
  ),
  // Building with a draped banner on one face.
  wall_wrap: (
    <>
      <path d="M4 21V6.5l7-3V21M11 8h9v13M3 21h18" />
      <path d="M13.5 11.5h4M13.5 14.5h4M7.5 9.5h.01M7.5 13h.01M7.5 16.5h.01" />
    </>
  ),
  bus_shelter: (
    <>
      <path d="M2.5 7h19M4 7l1.4-2.5h13.2L20 7M5 7v13M19 7v13M3 20h18" />
      <rect x="7.5" y="9.5" width="5.5" height="7.5" rx="0.8" />
      <path d="M15 16h2.5" />
    </>
  ),
  custom: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" strokeDasharray="3 2.4" />
      <path d="M12 9v6M9 12h6" />
    </>
  ),
};

export function MediaGlyph({
  type,
  className,
}: {
  type: string | null | undefined;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {SHAPES[type as MediaType] ?? SHAPES.custom}
    </svg>
  );
}
