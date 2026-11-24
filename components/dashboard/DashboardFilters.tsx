"use client";
// Dashboard date-range filter — a client component because it swaps
// custom from/to inputs in/out based on the selected preset without a
// full round-trip. On submit it writes `range` (always) and `from`/`to`
// (only when preset === "custom") to the URL, which the server-rendered
// dashboard reads to scope every section.
import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Calendar, ChevronDown } from "lucide-react";
import {
  DATE_RANGE_LABELS,
  DATE_RANGE_ORDER,
  describeDateRange,
  type DateRangePreset,
} from "@/lib/utils/date-ranges";

interface Props {
  currentPreset: DateRangePreset;
  from: string;
  to: string;
}

export function DashboardFilters({ currentPreset, from, to }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [preset, setPreset] = useState<DateRangePreset>(currentPreset);
  const [customFrom, setCustomFrom] = useState<string>(from);
  const [customTo, setCustomTo] = useState<string>(to);
  const [isPending, startTransition] = useTransition();

  // Keep local state in sync when URL changes from elsewhere (e.g. a
  // link click within the dashboard that mutates filters).
  useEffect(() => {
    setPreset(currentPreset);
    setCustomFrom(from);
    setCustomTo(to);
  }, [currentPreset, from, to]);

  function applyFilter(nextPreset: DateRangePreset, nextFrom?: string, nextTo?: string) {
    const params = new URLSearchParams(searchParams?.toString());
    params.set("range", nextPreset);
    if (nextPreset === "custom") {
      if (nextFrom) params.set("from", nextFrom);
      else params.delete("from");
      if (nextTo) params.set("to", nextTo);
      else params.delete("to");
    } else {
      params.delete("from");
      params.delete("to");
    }
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  function onPresetChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as DateRangePreset;
    setPreset(next);
    // For non-custom presets, apply immediately — no extra click needed.
    if (next !== "custom") applyFilter(next);
  }

  function onCustomApply(e: React.FormEvent) {
    e.preventDefault();
    if (!customFrom || !customTo) return;
    if (customFrom > customTo) return;
    applyFilter("custom", customFrom, customTo);
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="relative inline-flex items-center">
          <Calendar
            className="pointer-events-none absolute left-4 z-10 size-4 text-volt"
            aria-hidden
          />
          <select
            value={preset}
            onChange={onPresetChange}
            disabled={isPending}
            className="glass h-11 min-w-[200px] cursor-pointer appearance-none rounded-full pl-11 pr-11 text-sm font-medium text-white outline-none transition-colors hover:border-white/25 focus-visible:ring-2 focus-visible:ring-volt/60 disabled:opacity-60 [&>option]:bg-popover [&>option]:text-popover-foreground"
            aria-label="Date range preset"
          >
            {DATE_RANGE_ORDER.map((key) => (
              <option key={key} value={key}>
                {DATE_RANGE_LABELS[key]}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-4 z-10 size-4 text-white/60"
            aria-hidden
          />
        </div>
        <span className="whitespace-nowrap text-xs text-white/65">
          {describeDateRange(from, to)}
        </span>
      </div>

      {preset === "custom" && (
        <form
          onSubmit={onCustomApply}
          className="flex flex-wrap items-center gap-2"
          aria-label="Custom date range"
        >
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="glass h-10 rounded-full px-4 text-sm text-white outline-none [color-scheme:dark] focus-visible:ring-2 focus-visible:ring-volt/60"
            aria-label="From date"
          />
          <span className="text-sm text-white/65">to</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="glass h-10 rounded-full px-4 text-sm text-white outline-none [color-scheme:dark] focus-visible:ring-2 focus-visible:ring-volt/60"
            aria-label="To date"
          />
          <button
            type="submit"
            className="btn-pill h-10 disabled:opacity-50"
            disabled={isPending || !customFrom || !customTo || customFrom > customTo}
          >
            Apply
          </button>
        </form>
      )}
    </div>
  );
}
