"use client";

// DashboardCharts — recharts-based chart components for the owner
// dashboard.
//
// Exports:
//   RevenueCostChart     — grouped bars, revenue vs cost per month
//   CashFlowChart        — line pair, inflow vs outflow per month
//   CityBookingsChart    — horizontal bar, booked value by city
//   CityOccupancyChart   — stacked horizontal bar, booked vs available
//
// All monetary props are in INTEGER PAISE. Y-axis renders in Lakhs (1L
// = 1,00,000 INR) for readability; tooltips show the full INR value.
//
// Palette direction
// -----------------
// The dashboard's one accent is a hoarding-vinyl amber. In every chart
// here the accent marks the figure that matters most — the current
// month, the "we received this" line, the booked share. Everything
// else sits in neutral steps of the ramp. No rainbow series, no glow,
// no gradient fills. Colours come from the CSS variables set in
// app/globals.css so they track light / dark mode.

import { inr } from "@/lib/utils";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Cell,
} from "recharts";

// Palette — pulled from the CSS tokens so the charts track dark/light.
// chart-1 is the amber accent; chart-2..4 are stepped neutrals; chart-5
// is a reserved calm teal for "healthy" indicators.
const C = {
  accent: "var(--color-chart-1)",
  neutral1: "var(--color-chart-2)",
  neutral2: "var(--color-chart-3)",
  neutral3: "var(--color-chart-4)",
  healthy: "var(--color-chart-5)",
  grid: "color-mix(in oklch, var(--color-border) 65%, transparent)",
  axisTick: "var(--color-muted-foreground)",
  tooltipBg: "var(--color-popover)",
  tooltipFg: "var(--color-popover-foreground)",
  tooltipBorder: "var(--color-border)",
};

const TOOLTIP_STYLE: React.CSSProperties = {
  fontSize: 12,
  background: C.tooltipBg,
  color: C.tooltipFg,
  border: `1px solid ${C.tooltipBorder}`,
  borderRadius: 8,
  boxShadow: "none",
  padding: "8px 10px",
};

const AXIS_TICK = {
  fontSize: 11,
  fill: C.axisTick,
  fontVariantNumeric: "tabular-nums",
} as const;

const LAKH_FMT = (v: number) => `${(v / 10_000_000).toFixed(1)}L`;

// ─── RevenueCostChart ─────────────────────────────────────────────────────────

interface RevenueCostDataPoint {
  month: string;       // e.g. "Apr 25"
  revenue: number;     // paise
  costs: number;       // paise
}

interface RevenueCostChartProps {
  data: RevenueCostDataPoint[];
}

export function RevenueCostChart({ data }: RevenueCostChartProps) {
  // Pick the "current" month as the last non-zero entry. If every bar
  // is zero, no highlight — nothing is misleadingly loud.
  const leadIdx = findLeadIdx(data, (r) => r.revenue + r.costs);

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 3" stroke={C.grid} vertical={false} />

        <XAxis
          dataKey="month"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
        />

        <YAxis
          tickFormatter={LAKH_FMT}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={44}
        />

        <Tooltip
          formatter={(v) => [typeof v === "number" ? inr(v) : String(v), ""]}
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: "color-mix(in oklch, var(--color-muted) 60%, transparent)" }}
        />

        <Legend wrapperStyle={{ fontSize: 11, color: C.axisTick, paddingTop: 8 }} />

        {/* Revenue carries the accent. The current month lights up
            fully; prior months stay quiet so the eye lands on "now". */}
        <Bar dataKey="revenue" name="Revenue" radius={[2, 2, 0, 0]}>
          {data.map((_, i) => (
            <Cell
              key={`r-${i}`}
              fill={i === leadIdx ? C.accent : C.neutral1}
              fillOpacity={i === leadIdx ? 1 : 0.55}
            />
          ))}
        </Bar>
        {/* Cost reads as the quiet counterweight — same stepped neutral
            everywhere, no highlight. */}
        <Bar
          dataKey="costs"
          name="Cost"
          fill={C.neutral3}
          radius={[2, 2, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── CashFlowChart ────────────────────────────────────────────────────────────

interface CashFlowDataPoint {
  month: string;     // e.g. "Apr 25"
  inflow: number;    // paise
  outflow: number;   // paise
}

interface CashFlowChartProps {
  data: CashFlowDataPoint[];
}

export function CashFlowChart({ data }: CashFlowChartProps) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 3" stroke={C.grid} vertical={false} />

        <XAxis
          dataKey="month"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
        />

        <YAxis
          tickFormatter={LAKH_FMT}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={44}
        />

        <Tooltip
          formatter={(v) => [typeof v === "number" ? inr(v) : String(v), ""]}
          contentStyle={TOOLTIP_STYLE}
          cursor={{ stroke: C.grid }}
        />

        <Legend wrapperStyle={{ fontSize: 11, color: C.axisTick, paddingTop: 8 }} />

        {/* Inflow is the signal to read first — accent amber. */}
        <Line
          type="monotone"
          dataKey="inflow"
          name="Inflow"
          stroke={C.accent}
          strokeWidth={1.75}
          dot={{ r: 2.5, fill: C.accent, strokeWidth: 0 }}
          activeDot={{ r: 4 }}
        />
        {/* Outflow in a neutral step so cost doesn't shout. */}
        <Line
          type="monotone"
          dataKey="outflow"
          name="Outflow"
          stroke={C.neutral2}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          dot={{ r: 2.5, fill: C.neutral2, strokeWidth: 0 }}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── CityBookingsChart ────────────────────────────────────────────────────────
// Horizontal bars, booked value per city. The leading city gets the
// accent — it's the city carrying the book — the rest sit in stepped
// neutrals so the hierarchy reads top to bottom.

interface CityBookingDataPoint {
  city: string;
  value: number; // paise
  sites: number;
}

export function CityBookingsChart({ data }: { data: CityBookingDataPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="h-[224px] flex items-center justify-center text-sm text-muted-foreground">
        No bookings in this range
      </div>
    );
  }
  const leadIdx = findLeadIdx(data, (r) => r.value);
  return (
    <ResponsiveContainer width="100%" height={Math.max(224, data.length * 36)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="2 3" stroke={C.grid} horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={LAKH_FMT}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="category"
          dataKey="city"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={110}
        />
        <Tooltip
          formatter={(v) => [typeof v === "number" ? inr(v) : String(v), "Booked"]}
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: "color-mix(in oklch, var(--color-muted) 60%, transparent)" }}
        />
        <Bar
          dataKey="value"
          name="Booked value"
          radius={[0, 2, 2, 0]}
        >
          {data.map((_, i) => (
            <Cell
              key={`c-${i}`}
              fill={i === leadIdx ? C.accent : C.neutral1}
              fillOpacity={i === leadIdx ? 1 : 0.55}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── CityOccupancyChart ────────────────────────────────────────────────────
// Companion to CityBookingsChart. Each city shows booked + available as
// a stacked bar. "Booked" takes the accent (it's what matters to a
// sales lead), "Available" sits as a muted track underneath.

interface CityOccupancyDataPoint {
  city: string;
  booked: number;
  available: number;
}

export function CityOccupancyChart({
  data,
}: {
  data: CityOccupancyDataPoint[];
}) {
  if (data.length === 0) {
    return (
      <div className="h-[224px] flex items-center justify-center text-sm text-muted-foreground">
        No sites yet
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(224, data.length * 36)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="2 3" stroke={C.grid} horizontal={false} />
        <XAxis
          type="number"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey="city"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={110}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "color-mix(in oklch, var(--color-muted) 60%, transparent)" }} />
        <Legend wrapperStyle={{ fontSize: 11, color: C.axisTick, paddingTop: 8 }} />
        <Bar
          dataKey="booked"
          name="Booked"
          stackId="a"
          fill={C.accent}
        />
        <Bar
          dataKey="available"
          name="Available"
          stackId="a"
          fill={C.neutral3}
          radius={[0, 2, 2, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// Index of the LAST row whose selector is non-zero. Used to pick which
// bar carries the accent — usually the current month / top city — so
// the chart highlights the thing the viewer actually cares about.
function findLeadIdx<T>(data: T[], select: (row: T) => number): number {
  for (let i = data.length - 1; i >= 0; i--) {
    if (select(data[i]) > 0) return i;
  }
  return -1;
}
