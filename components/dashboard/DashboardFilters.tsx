"use client";
// Dashboard date-range filter — a client component because it swaps
// custom from/to inputs in/out based on the selected preset without a
// full round-trip. On submit it writes `range` (always) and `from`/`to`
// (only when preset === "custom") to the URL, which the server-rendered
// dashboard reads to scope every section.
import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Calendar, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="relative inline-flex items-center">
        <Calendar className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
        <select
          value={preset}
          onChange={onPresetChange}
          disabled={isPending}
          className="h-10 rounded-md border border-input bg-background pl-9 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 appearance-none min-w-[200px] disabled:opacity-60"
          aria-label="Date range preset"
        >
          {DATE_RANGE_ORDER.map((key) => (
            <option key={key} value={key}>
              {DATE_RANGE_LABELS[key]}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 h-4 w-4 text-muted-foreground pointer-events-none" />
      </div>

      {preset === "custom" && (
        <form
          onSubmit={onCustomApply}
          className="flex items-center gap-2"
          aria-label="Custom date range"
        >
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
            aria-label="From date"
          />
          <span className="text-muted-foreground text-sm">to</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
            aria-label="To date"
          />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={isPending || !customFrom || !customTo || customFrom > customTo}
          >
            Apply
          </Button>
        </form>
      )}

      <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
        {describeDateRange(from, to)}
      </span>
    </div>
  );
}
