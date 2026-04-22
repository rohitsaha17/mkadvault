// Reusable <select> for Indian states + Union Territories.
// Designed to be a drop-in replacement for <Input {...register("state")} />
// in existing react-hook-form forms — callers just swap the component and
// keep spreading their register props. We ship it as a plain native select
// (matching NativeSelect elsewhere) for accessibility + zero-JS rendering.
import * as React from "react";
import { cn } from "@/lib/utils";
import { INDIAN_STATES_AND_UTS } from "@/lib/constants/indian-states";

type Props = React.SelectHTMLAttributes<HTMLSelectElement> & {
  // When true, shows a "Select a state…" placeholder as the first option.
  // Default: true. Pass false if you want an empty first option instead.
  placeholder?: string | false;
  error?: boolean;
};

export const IndianStateSelect = React.forwardRef<HTMLSelectElement, Props>(
  function IndianStateSelect(
    { className, placeholder = "Select a state…", error, ...props },
    ref,
  ) {
    return (
      <select
        ref={ref}
        {...props}
        className={cn(
          "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
          "disabled:cursor-not-allowed disabled:opacity-50",
          error && "border-destructive focus-visible:ring-destructive/40",
          className,
        )}
      >
        {placeholder !== false && (
          <option value="">{placeholder}</option>
        )}
        {INDIAN_STATES_AND_UTS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    );
  },
);
