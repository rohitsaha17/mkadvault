"use client";

import { useState, useEffect } from "react";
import { addMonths, subDays, format } from "date-fns";

interface DurationSelectorProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  className?: string;
}

const DURATION_OPTIONS = [
  { label: "Custom", value: "custom" },
  { label: "1 Month", value: "1" },
  { label: "2 Months", value: "2" },
  { label: "3 Months", value: "3" },
  { label: "6 Months", value: "6" },
  { label: "1 Year", value: "12" },
] as const;

const inputClassName =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1";

function calculateEndDate(startDate: string, months: number): string {
  const start = new Date(startDate);
  const end = subDays(addMonths(start, months), 1);
  return format(end, "yyyy-MM-dd");
}

export function DurationSelector({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  className,
}: DurationSelectorProps) {
  const [duration, setDuration] = useState<string>("custom");

  // When start date changes and a preset duration is selected, recalculate end date
  useEffect(() => {
    if (duration !== "custom" && startDate) {
      const months = parseInt(duration, 10);
      onEndDateChange(calculateEndDate(startDate, months));
    }
  }, [startDate, duration, onEndDateChange]);

  function handleDurationChange(value: string) {
    setDuration(value);
    if (value !== "custom" && startDate) {
      const months = parseInt(value, 10);
      onEndDateChange(calculateEndDate(startDate, months));
    }
  }

  function handleEndDateChange(date: string) {
    setDuration("custom");
    onEndDateChange(date);
  }

  return (
    <div className={`grid grid-cols-1 gap-3 sm:grid-cols-3 ${className ?? ""}`}>
      <div>
        <label className="mb-1 block text-sm font-medium">Start Date</label>
        <input
          type="date"
          value={startDate}
          onChange={(e) => onStartDateChange(e.target.value)}
          className={inputClassName}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Duration</label>
        <select
          value={duration}
          onChange={(e) => handleDurationChange(e.target.value)}
          className={inputClassName}
        >
          {DURATION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">End Date</label>
        <input
          type="date"
          value={endDate}
          onChange={(e) => handleEndDateChange(e.target.value)}
          className={inputClassName}
        />
      </div>
    </div>
  );
}
