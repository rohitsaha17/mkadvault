"use client";
// SiteFilters — client component that manages filter state via URL search params.
// When any filter changes, it pushes a new URL so the server re-fetches data.
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  cities: string[];       // distinct cities from the current dataset (for the city dropdown)
  currentSearch: string;
  currentCity: string;
  currentType: string;
  currentStatus: string;
  currentOwnership: string;
}

const MEDIA_TYPE_OPTIONS = [
  { value: "", label: "All Types" },
  { value: "billboard", label: "Billboard" },
  { value: "hoarding", label: "Hoarding" },
  { value: "dooh", label: "DOOH" },
  { value: "kiosk", label: "Kiosk" },
  { value: "wall_wrap", label: "Wall Wrap" },
  { value: "unipole", label: "Unipole" },
  { value: "bus_shelter", label: "Bus Shelter" },
  { value: "custom", label: "Custom" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "available", label: "Available" },
  { value: "booked", label: "Booked" },
  { value: "maintenance", label: "Maintenance" },
  { value: "blocked", label: "Blocked" },
  { value: "expired", label: "Expired" },
];

const OWNERSHIP_OPTIONS = [
  { value: "", label: "All Ownership" },
  { value: "owned", label: "Owned" },
  { value: "rented", label: "Rented" },
];

export function SiteFilters({
  cities,
  currentSearch,
  currentCity,
  currentType,
  currentStatus,
  currentOwnership,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // Controlled search input. We keep a local state so typing feels
  // instant; a 250 ms debounce pushes the URL update so the server
  // re-fetches without firing a query on every keystroke.
  const [searchValue, setSearchValue] = useState(currentSearch);
  // Re-sync from props when the URL changes externally (e.g. Clear
  // button, browser back, another filter wiping search).
  useEffect(() => {
    setSearchValue(currentSearch);
  }, [currentSearch]);

  const hasActiveFilters =
    currentSearch || currentCity || currentType || currentStatus || currentOwnership;

  // Build a new URL with updated params while keeping other params intact
  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      // Reset to page 1 when any filter changes
      params.delete("page");
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`);
      });
    },
    [router, pathname, searchParams]
  );

  // Debounced search-URL writer. Cancels previous pending writes if
  // the user keeps typing — only the last value within the debounce
  // window actually navigates.
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateSearch = useCallback(
    (raw: string) => {
      setSearchValue(raw);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => {
        // Compare against the URL's current value rather than the prop
        // so we don't fire a no-op navigation when the user retypes
        // the same string they already had.
        if (raw !== (searchParams.get("q") ?? "")) {
          updateParam("q", raw.trim());
        }
      }, 250);
    },
    [searchParams, updateParam],
  );

  // Cleanup any in-flight debounce on unmount.
  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  function clearAll() {
    startTransition(() => {
      router.push(pathname);
    });
  }

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {/* Search input — live filter as you type. 250 ms debounce so
          rapid typing doesn't fire a SQL query per keystroke. Enter
          flushes the debounce immediately for users who prefer the
          old "type then commit" feel. */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          type="search"
          value={searchValue}
          onChange={(e) => updateSearch(e.target.value)}
          placeholder="Search name or code…"
          className="pl-8 h-8 w-48 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
              updateParam("q", searchValue.trim());
            }
          }}
        />
      </div>

      {/* City dropdown */}
      {cities.length > 0 && (
        <FilterSelect
          value={currentCity}
          onChange={(v) => updateParam("city", v)}
          options={[
            { value: "", label: "All Cities" },
            ...cities.map((c) => ({ value: c, label: c })),
          ]}
        />
      )}

      {/* Media type */}
      <FilterSelect
        value={currentType}
        onChange={(v) => updateParam("type", v)}
        options={MEDIA_TYPE_OPTIONS}
      />

      {/* Status */}
      <FilterSelect
        value={currentStatus}
        onChange={(v) => updateParam("status", v)}
        options={STATUS_OPTIONS}
      />

      {/* Ownership */}
      <FilterSelect
        value={currentOwnership}
        onChange={(v) => updateParam("ownership", v)}
        options={OWNERSHIP_OPTIONS}
      />

      {/* Clear all */}
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearAll}
          className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}

// Small styled <select> used for filters
function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring hover:border-border"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
