"use client";

// Dashboard charts.
//
//   RevenueCostChart — paired bars per bucket
//   CashFlowChart    — received (area) against paid out (line)
//
// All money props are INTEGER PAISE. Colour follows the series, never the
// position: revenue / received is always the accent, cost / paid out is always
// grey. Labels and legends use text colours so they stay readable.
//
// Buckets that haven't happened yet carry null, so a line stops at today
// instead of diving to zero for the rest of the year.

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { inr } from "@/lib/utils";

const ACCENT = "var(--color-chart-1)";
const GREY = "var(--color-chart-2)";
const GRID = "var(--color-border)";
const CURSOR = "color-mix(in oklch, var(--color-foreground) 6%, transparent)";

const AXIS = {
  tick: { fontSize: 11, fill: "var(--color-muted-foreground)" },
  tickLine: false,
  axisLine: false,
} as const;

/** ₹ in lakhs / crores for axis ticks; the tooltip shows the full amount. */
function compact(paise: number): string {
  const rupees = paise / 100;
  const abs = Math.abs(rupees);
  const trim = (n: number) => String(Number(n.toFixed(1)));
  if (abs >= 10_000_000) return `${trim(rupees / 10_000_000)}Cr`;
  if (abs >= 100_000) return `${trim(rupees / 100_000)}L`;
  if (abs >= 1_000) return `${trim(rupees / 1_000)}K`;
  return trim(rupees);
}

const money = (paise: number) => inr(paise).replace("-", "−");

// ─── Shared tooltip ─────────────────────────────────────────────────────────

interface TooltipRow {
  key: string;
  label: string;
  color?: string;
}

interface ChartTooltipProps {
  active?: boolean;
  label?: React.ReactNode;
  payload?: ReadonlyArray<{ payload?: unknown }>;
  rows: TooltipRow[];
  /** Optional last line worked out from the point, e.g. the net. */
  total?: { label: string; of: (point: Record<string, number>) => number };
}

function ChartTooltip({
  active,
  label,
  payload,
  rows,
  total,
}: ChartTooltipProps) {
  const point = payload?.[0]?.payload as
    | Record<string, number | null>
    | undefined;
  if (!active || !point) return null;
  const shown = rows.filter((r) => typeof point[r.key] === "number");
  if (shown.length === 0) return null;

  return (
    <div className="min-w-40 rounded-xl border border-border bg-popover px-3 py-2.5 text-popover-foreground shadow-lg">
      <p className="mb-2 text-xs text-muted-foreground">{label}</p>
      <ul className="space-y-1.5">
        {shown.map((row) => (
          <li key={row.key} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className="h-0.5 w-3 rounded-full"
              style={{ background: row.color }}
            />
            <span className="text-muted-foreground">{row.label}</span>
            <span className="ml-auto pl-4 font-semibold tabular-nums">
              {money(point[row.key] as number)}
            </span>
          </li>
        ))}
        {total && (
          <li className="flex items-center gap-2 border-t border-border pt-1.5 text-xs">
            <span className="text-muted-foreground">{total.label}</span>
            <span className="ml-auto pl-4 font-semibold tabular-nums">
              {money(total.of(point as Record<string, number>))}
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}

/** The same numbers as a table, for screen readers. */
function DataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: Array<{ label: string; values: Array<number | null> }>;
}) {
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th />
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th>{r.label}</th>
              {r.values.map((v, i) => (
                <td key={columns[i]}>{v === null ? "" : money(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Revenue vs cost ────────────────────────────────────────────────────────

export interface RevenueCostPoint {
  label: string;
  revenue: number | null;
  cost: number | null;
}

export function RevenueCostChart({
  data,
  labels,
}: {
  data: RevenueCostPoint[];
  labels: { caption: string; revenue: string; cost: string; net: string };
}) {
  return (
    <>
      <div aria-hidden>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart
            data={data}
            barGap={2}
            barCategoryGap="22%"
            margin={{ top: 8, right: 4, left: 0, bottom: 0 }}
          >
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="label"
              interval="preserveStartEnd"
              minTickGap={18}
              {...AXIS}
            />
            <YAxis tickFormatter={compact} width={40} {...AXIS} />
            <Tooltip
              cursor={{ fill: CURSOR, radius: 8 }}
              content={
                <ChartTooltip
                  rows={[
                    { key: "revenue", label: labels.revenue, color: ACCENT },
                    { key: "cost", label: labels.cost, color: GREY },
                  ]}
                  total={{
                    label: labels.net,
                    of: (p) => (p.revenue ?? 0) - (p.cost ?? 0),
                  }}
                />
              }
            />
            <Bar
              dataKey="revenue"
              fill={ACCENT}
              radius={[4, 4, 0, 0]}
              maxBarSize={18}
            />
            <Bar
              dataKey="cost"
              fill={GREY}
              radius={[4, 4, 0, 0]}
              maxBarSize={18}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable
        caption={labels.caption}
        columns={[labels.revenue, labels.cost]}
        rows={data.map((d) => ({
          label: d.label,
          values: [d.revenue, d.cost],
        }))}
      />
    </>
  );
}

// ─── Cash flow ──────────────────────────────────────────────────────────────

export interface CashFlowPoint {
  label: string;
  inflow: number | null;
  outflow: number | null;
}

const DOT = { r: 4, strokeWidth: 2, stroke: "var(--color-card)" };

export function CashFlowChart({
  data,
  labels,
}: {
  data: CashFlowPoint[];
  labels: { caption: string; inflow: string; outflow: string; net: string };
}) {
  return (
    <>
      <div aria-hidden>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart
            data={data}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="inflow-wash" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ACCENT} stopOpacity={0.22} />
                <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="label"
              interval="preserveStartEnd"
              minTickGap={24}
              {...AXIS}
            />
            <YAxis tickFormatter={compact} width={40} {...AXIS} />
            <Tooltip
              cursor={{ stroke: "var(--color-muted-foreground)", strokeWidth: 1 }}
              content={
                <ChartTooltip
                  rows={[
                    { key: "inflow", label: labels.inflow, color: ACCENT },
                    { key: "outflow", label: labels.outflow, color: GREY },
                  ]}
                  total={{
                    label: labels.net,
                    of: (p) => (p.inflow ?? 0) - (p.outflow ?? 0),
                  }}
                />
              }
            />
            <Area
              type="monotone"
              dataKey="outflow"
              stroke={GREY}
              strokeWidth={2}
              fill="none"
              dot={false}
              activeDot={{ ...DOT, fill: GREY }}
            />
            <Area
              type="monotone"
              dataKey="inflow"
              stroke={ACCENT}
              strokeWidth={2}
              fill="url(#inflow-wash)"
              dot={false}
              activeDot={{ ...DOT, fill: ACCENT }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <DataTable
        caption={labels.caption}
        columns={[labels.inflow, labels.outflow]}
        rows={data.map((d) => ({
          label: d.label,
          values: [d.inflow, d.outflow],
        }))}
      />
    </>
  );
}
