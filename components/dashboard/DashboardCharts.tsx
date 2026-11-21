"use client";

// DashboardCharts — recharts-based chart components for the owner dashboard.
//
// Exports:
//   RevenueCostChart  — bar chart comparing revenue vs costs per month
//   CashFlowChart     — line chart comparing inflow vs outflow per month
//
// All monetary props are in INTEGER PAISE.
// Y-axis displays values in Lakhs (e.g. "2.5L") for readability.
// Tooltips display full INR values using the standard formatter.

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
} from "recharts";

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
  return (
    <ResponsiveContainer width="100%" height={224}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />

        <XAxis
          dataKey="month"
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />

        {/* Y-axis shows values in Lakhs (1L = 1,00,000 INR = 1,00,00,000 paise) */}
        <YAxis
          tickFormatter={(v: number) => `${(v / 10_000_000).toFixed(1)}L`}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={44}
        />

        <Tooltip
          formatter={(v) => [
            typeof v === "number" ? inr(v) : String(v),
            "",
          ]}
          contentStyle={{ fontSize: 12 }}
        />

        <Legend wrapperStyle={{ fontSize: 12 }} />

        <Bar dataKey="revenue" name="Revenue" fill="#22c55e" radius={[3, 3, 0, 0]} />
        <Bar dataKey="costs"   name="Costs"   fill="#ef4444" radius={[3, 3, 0, 0]} />
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
    <ResponsiveContainer width="100%" height={224}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />

        <XAxis
          dataKey="month"
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />

        <YAxis
          tickFormatter={(v: number) => `${(v / 10_000_000).toFixed(1)}L`}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={44}
        />

        <Tooltip
          formatter={(v) => [
            typeof v === "number" ? inr(v) : String(v),
            "",
          ]}
          contentStyle={{ fontSize: 12 }}
        />

        <Legend wrapperStyle={{ fontSize: 12 }} />

        <Line
          type="monotone"
          dataKey="inflow"
          name="Inflow"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
        <Line
          type="monotone"
          dataKey="outflow"
          name="Outflow"
          stroke="#f59e0b"
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── CityBookingsChart ────────────────────────────────────────────────────────
// Horizontal bar chart: booking value (pro-rata) broken out by city.
// Used in the Bookings-by-City card on the dashboard. Shows the top N
// cities so even a sprawling book stays scannable; the "Others" row
// collapses the long tail into a single bar.

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
  // Leave extra left margin so long city names (Hubballi-Dharwad) fit.
  return (
    <ResponsiveContainer width="100%" height={Math.max(224, data.length * 36)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v: number) => `${(v / 10_000_000).toFixed(1)}L`}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="category"
          dataKey="city"
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={110}
        />
        <Tooltip
          formatter={(v) => [typeof v === "number" ? inr(v) : String(v), "Booked"]}
          contentStyle={{ fontSize: 12 }}
        />
        <Bar
          dataKey="value"
          name="Booked value"
          fill="#6366f1"
          radius={[0, 4, 4, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── CityOccupancyChart ────────────────────────────────────────────────────
// Companion bar chart to CityBookingsChart: shows, for each city, how
// many sites exist and how many are currently booked. Same layout so
// the two cards read as a pair.

interface CityOccupancyDataPoint {
  city: string;
  // Pass pre-split values so the stacked bar math is unambiguous.
  // booked + available = total sites in that city.
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
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="#e2e8f0"
          horizontal={false}
        />
        <XAxis
          type="number"
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey="city"
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={110}
        />
        <Tooltip contentStyle={{ fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar
          dataKey="booked"
          name="Booked"
          stackId="a"
          fill="#22c55e"
        />
        <Bar
          dataKey="available"
          name="Available"
          stackId="a"
          fill="#e2e8f0"
          radius={[0, 4, 4, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
