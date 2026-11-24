// RingMeter — one ratio against its whole, as a ring. The unfilled part is a
// lighter step of the same colour so the whole ring reads as one scale.
const RADIUS = 40;
const LENGTH = 2 * Math.PI * RADIUS;

export function RingMeter({
  percent,
  label,
  size = 104,
}: {
  percent: number;
  label: string;
  size?: number;
}) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div
      role="img"
      aria-label={label}
      className="relative shrink-0"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          stroke="var(--color-chart-1)"
          strokeOpacity="0.18"
          strokeWidth="11"
        />
        {clamped > 0 && (
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            stroke="var(--color-chart-1)"
            strokeWidth="11"
            strokeLinecap="round"
            strokeDasharray={`${(clamped / 100) * LENGTH} ${LENGTH}`}
          />
        )}
      </svg>
      <span className="figure absolute inset-0 flex items-center justify-center text-[26px] text-foreground">
        {clamped}%
      </span>
    </div>
  );
}
