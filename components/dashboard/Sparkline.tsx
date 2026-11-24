"use client";
// Sparkline — a small inline chart that sits in the corner of a KPI
// card, matching the "stat card + micro-chart" pattern from the
// reference comps (Nexora, Donezo, AeuxGlobal).
//
// Takes a single series of numbers (paise or any unit) and draws a
// smoothed line with a soft lime wash underneath. Width and height
// are configurable; defaults match a 72x24 chip that tucks next to a
// big figure without competing with it.
//
// `accent` toggles the fill treatment:
//   - true  → lime stroke + lime wash  (used on the lead KPI tile)
//   - false → neutral stroke + neutral wash (secondary cards)
import { useMemo } from "react";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  accent?: boolean;
  className?: string;
}

export function Sparkline({
  data,
  width = 96,
  height = 32,
  accent = false,
  className,
}: SparklineProps) {
  // Pad the series so a spark on fewer than ~6 points doesn't look
  // like a zig-zag — repeating the last value flattens the tail.
  const series = useMemo(() => {
    if (data.length === 0) return [0, 0];
    if (data.length === 1) return [data[0], data[0]];
    return data;
  }, [data]);

  const { pathD, areaD } = useMemo(() => {
    const min = Math.min(...series);
    const max = Math.max(...series);
    const span = max - min || 1;
    const step = width / (series.length - 1);
    const y = (v: number) =>
      height - ((v - min) / span) * (height - 4) - 2;
    const points = series.map((v, i) => [i * step, y(v)]);
    // Monotone smoothing — same vibe as recharts' monotone curves
    // without pulling the whole library into a chip.
    let p = `M ${points[0][0]} ${points[0][1]}`;
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      const cx = (x0 + x1) / 2;
      p += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
    }
    const area = `${p} L ${width} ${height} L 0 ${height} Z`;
    return { pathD: p, areaD: area };
  }, [series, width, height]);

  const stroke = accent
    ? "var(--color-primary)"
    : "var(--color-muted-foreground)";
  const fill = accent
    ? "color-mix(in oklch, var(--color-primary) 22%, transparent)"
    : "color-mix(in oklch, var(--color-muted-foreground) 14%, transparent)";

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      aria-hidden
    >
      <path d={areaD} fill={fill} />
      <path
        d={pathD}
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
