import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getOrganicTrend } from "@/serverFunctions/observability";
import type { SearchPerformanceDateRange } from "@/types/schemas/search-performance";

const RANGES: { key: SearchPerformanceDateRange; label: string }[] = [
  { key: "last_7_days", label: "7d" },
  { key: "last_28_days", label: "28d" },
  { key: "last_3_months", label: "3m" },
];

type TrendMetric = "clicks" | "impressions" | "position";
const METRICS: { key: TrendMetric; label: string }[] = [
  { key: "clicks", label: "Clicks" },
  { key: "impressions", label: "Impressions" },
  { key: "position", label: "Position" },
];

function shortDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function compactNumber(value: number): string {
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function metricLabel(metric: TrendMetric, value: number | null | undefined): string {
  if (value == null) return "—";
  return metric === "position" ? value.toFixed(1) : compactNumber(value);
}

function TrendTooltip({
  active,
  payload,
  label,
  metric,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ value?: number | string }>;
  label?: string | number;
  metric: TrendMetric;
}) {
  if (!active || !payload?.length) return null;
  const value = Number(payload[0]?.value);
  return (
    <div className="rounded-lg border border-base-300 bg-base-100 px-3 py-2 shadow-xl">
      <p className="font-mono text-[10px] uppercase tracking-wider text-base-content/50">
        {shortDate(String(label ?? "")) || "—"}
      </p>
      <p
        className={`text-lg font-semibold tabular-nums ${
          metric === "position" ? "text-cyan" : "text-primary"
        }`}
      >
        {metricLabel(metric, value)}
      </p>
    </div>
  );
}

/**
 * Interactive organic-traffic area chart (GSC first-party data). Range tabs
 * and a metric toggle reshape the same free query; the tooltip gives exact
 * day values. Degrades to a connect prompt when GSC isn't linked.
 */
export function TrendChart({
  projectId,
  dateRange,
  onChange,
}: {
  projectId: string;
  dateRange: SearchPerformanceDateRange;
  onChange: (dateRange: SearchPerformanceDateRange) => void;
}) {
  const [metric, setMetric] = React.useState<TrendMetric>("clicks");
  const trendQuery = useQuery({
    queryKey: ["organicTrend", projectId, dateRange],
    queryFn: () => getOrganicTrend({ data: { projectId, dateRange } }),
  });

  const rangeLabel =
    RANGES.find((range) => range.key === dateRange)?.label ?? "28d";
  const trend = trendQuery.data;
  const series = trend?.connected ? trend.series : [];
  const stroke = metric === "position" ? "var(--color-cyan)" : "var(--color-primary)";

  return (
    <div className="overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-base-300 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Organic traffic</h2>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-base-content/45">
            Google Search Console · last {rangeLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-md border border-base-300 bg-base-200/60 p-0.5">
            {METRICS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setMetric(item.key)}
                aria-pressed={metric === item.key}
                className={`rounded px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                  metric === item.key
                    ? "bg-base-100 text-base-content shadow-sm"
                    : "text-base-content/45 hover:text-base-content/70"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-0.5 rounded-md border border-base-300 bg-base-200/60 p-0.5">
            {RANGES.map((range) => (
              <button
                key={range.key}
                type="button"
                onClick={() => onChange(range.key)}
                aria-pressed={dateRange === range.key}
                className={`rounded px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                  dateRange === range.key
                    ? "bg-base-100 text-base-content shadow-sm"
                    : "text-base-content/45 hover:text-base-content/70"
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-4">
        {trendQuery.isPending ? (
          <div className="h-56 animate-pulse rounded-lg bg-base-200/60" aria-busy />
        ) : trend?.connected === false ? (
          <div className="flex h-56 flex-col items-start justify-center gap-2 px-2">
            <p className="text-sm font-medium">No Search Console data yet</p>
            <p className="text-sm text-base-content/60">
              Link your property once and AbbaSeo charts your real organic traffic.
            </p>
            <Link
              to="/p/$projectId/search-performance"
              params={{ projectId }}
              className="link link-primary text-sm font-medium"
            >
              Connect Search Console →
            </Link>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={224}>
            <AreaChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor={stroke}
                    stopOpacity={0.28}
                  />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                stroke="color-mix(in oklab, var(--color-base-content) 8%, transparent)"
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tickFormatter={shortDate}
                tick={{ fontSize: 10, fill: "currentColor" }}
                stroke="transparent"
                tickLine={false}
                axisLine={false}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={() => ""}
                width={0}
                tickLine={false}
                axisLine={false}
                domain={metric === "position" ? ["dataMin - 1", "dataMax + 1"] : [0, "auto"]}
                reversed={metric === "position"}
              />
              <Tooltip
                content={<TrendTooltip metric={metric} />}
                cursor={{
                  stroke: "color-mix(in oklab, var(--color-base-content) 18%, transparent)",
                  strokeWidth: 1,
                }}
              />
              <Area
                type="monotone"
                dataKey={metric}
                stroke={stroke}
                strokeWidth={2}
                fill="url(#trendFill)"
                activeDot={{ r: 3.5, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}