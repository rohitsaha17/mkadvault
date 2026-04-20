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
