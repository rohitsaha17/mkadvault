"use client";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { inr } from "@/lib/utils";

interface MonthData {
  label: string;
  invoiced: number;
  collected: number;
  paid_out: number;
}

interface Props {
  data: MonthData[];
}

function inrShort(paise: number) {
  const rupees = paise / 100;
  if (rupees >= 10000000) return `₹${(rupees / 10000000).toFixed(1)}Cr`;
  if (rupees >= 100000) return `₹${(rupees / 100000).toFixed(1)}L`;
  if (rupees >= 1000) return `₹${(rupees / 1000).toFixed(0)}K`;
  return `₹${rupees.toFixed(0)}`;
}

export function RevenueChart({ data }: Props) {
  // Only show months that have any data or keep all for continuity
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11 }}
          className="text-muted-foreground"
        />
        <YAxis
          tickFormatter={inrShort}
          tick={{ fontSize: 11 }}
          width={60}
          className="text-muted-foreground"
        />
        <Tooltip
          formatter={(value, name) => [
            typeof value === "number" ? inr(value) : String(value),
            name === "invoiced" ? "Invoiced" : name === "collected" ? "Collected" : "Paid Out",
          ]}
          labelStyle={{ fontWeight: 600 }}
          contentStyle={{ fontSize: 12 }}
        />
        <Legend
          formatter={(value) =>
            value === "invoiced" ? "Invoiced" : value === "collected" ? "Collected" : "Paid Out"
          }
        />
        <Bar dataKey="invoiced" fill="#3b82f6" radius={[2, 2, 0, 0]} />
        <Bar dataKey="collected" fill="#22c55e" radius={[2, 2, 0, 0]} />
        <Bar dataKey="paid_out" fill="#ef4444" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
