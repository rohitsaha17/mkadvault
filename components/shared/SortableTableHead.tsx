"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";

interface SortableTableHeadProps {
  column: string;
  label: string;
  currentSort: string | null;
  currentDir: "asc" | "desc" | null;
  // The page's implicit default sort/dir applied when the URL carries
  // no `sort` param. Without this the column that's actually driving
  // the SQL ORDER BY shows no arrow on initial load, AND the first
  // click on it writes the same direction back to the URL — looking
  // like the toggle did nothing. Pass the same defaults the page uses
  // for its own sort calculation.
  defaultSort?: string;
  defaultDir?: "asc" | "desc";
}

export function SortableTableHead({
  column,
  label,
  currentSort,
  currentDir,
  defaultSort,
  defaultDir = "asc",
}: SortableTableHeadProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // The column is "active" if it's named explicitly in the URL, OR
  // the URL is silent and this column is the page's implicit default.
  const isActive =
    currentSort === column || (currentSort == null && defaultSort === column);
  // Effective direction reflects what the SQL is actually doing, not
  // just what's typed into the URL.
  const effectiveDir: "asc" | "desc" =
    currentDir ?? (currentSort == null && defaultSort === column ? defaultDir : "asc");

  function handleClick() {
    const params = new URLSearchParams(searchParams.toString());

    if (isActive) {
      // Flip direction relative to the *effective* current direction
      // so the first click on the default-sorted column does what the
      // user expects (toggle from asc → desc).
      const newDir = effectiveDir === "asc" ? "desc" : "asc";
      params.set("sort", column);
      params.set("dir", newDir);
    } else {
      // First click on a new column starts ascending.
      params.set("sort", column);
      params.set("dir", "asc");
    }

    router.push(`?${params.toString()}`);
  }

  return (
    <th
      onClick={handleClick}
      className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground cursor-pointer select-none group"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive ? (
          effectiveDir === "asc" ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-0 group-hover:opacity-50 transition-opacity" />
        )}
      </span>
    </th>
  );
}
