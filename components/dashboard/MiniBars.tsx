// MiniBars — the small bar strip at the bottom of a KPI card.
//
// Buckets still in the future are drawn as dots so a half-finished year
// doesn't look like revenue fell to zero. Each bar carries its value as a
// native tooltip, and the strip is summarised once for screen readers.
import { cn } from "@/lib/utils";

export interface MiniBar {
  label: string;
  value: number;
  display: string;
  current: boolean;
  future: boolean;
}

type Tone = "ink" | "neutral" | "signed";

const FILL: Record<Tone, { past: string; current: string; dot: string }> = {
  ink: { past: "bg-ink/35", current: "bg-ink", dot: "bg-ink/25" },
  neutral: {
    past: "bg-foreground/22",
    current: "bg-foreground/85",
    dot: "bg-foreground/15",
  },
  signed: { past: "", current: "", dot: "bg-foreground/15" },
};

export function MiniBars({
  bars,
  tone,
  summary,
  className,
}: {
  bars: MiniBar[];
  tone: Tone;
  summary: string;
  className?: string;
}) {
  const peak = Math.max(1, ...bars.map((b) => Math.abs(b.value)));
  const fill = FILL[tone];
  const signed = tone === "signed";

  return (
    <div
      role="img"
      aria-label={summary}
      className={cn("flex h-12 items-stretch gap-1", className)}
    >
      {bars.map((bar, i) => {
        const size = `${Math.max(6, (Math.abs(bar.value) / peak) * 100)}%`;
        const title = `${bar.label}: ${bar.display}`;

        if (bar.future || bar.value === 0) {
          return (
            <span
              key={i}
              title={bar.future ? bar.label : title}
              className={cn(
                "flex max-w-4 flex-1 justify-center",
                signed ? "items-center" : "items-end",
              )}
            >
              <span className={cn("size-1 rounded-full", fill.dot)} />
            </span>
          );
        }

        if (signed) {
          const up = bar.value > 0;
          return (
            <span
              key={i}
              title={title}
              className="flex max-w-4 flex-1 flex-col"
            >
              <span className="flex flex-1 items-end">
                {up && (
                  <span
                    className="w-full rounded-t-[4px] bg-chart-1"
                    style={{ height: size }}
                  />
                )}
              </span>
              <span className="flex flex-1 items-start">
                {!up && (
                  <span
                    className="w-full rounded-b-[4px] bg-destructive"
                    style={{ height: size }}
                  />
                )}
              </span>
            </span>
          );
        }

        return (
          <span key={i} title={title} className="flex max-w-4 flex-1 items-end">
            <span
              className={cn(
                "w-full rounded-t-[4px] rounded-b-[2px]",
                bar.current ? fill.current : fill.past,
              )}
              style={{ height: size }}
            />
          </span>
        );
      })}
    </div>
  );
}
