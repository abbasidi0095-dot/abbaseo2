import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Eye,
  Gauge,
  Globe,
  MousePointerClick,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import type { DashboardBacklinkSummary } from "@/server/features/dashboard/services/DashboardService";
import {
  formatCount,
  formatPosition,
} from "@/client/features/search-performance/SearchPerformanceColumns";
import { PercentDelta } from "@/client/features/dashboard/cardParts";
import {
  getOrganicTrend,
  getRankPositionDistribution,
} from "@/serverFunctions/observability";
import type { SearchPerformanceDateRange } from "@/types/schemas/search-performance";

function HeroTile({
  icon: Icon,
  label,
  value,
  delta,
  sub,
  empty,
}: {
  icon: LucideIcon;
  label: string;
  value?: string | null;
  delta?: React.ReactNode;
  sub?: React.ReactNode;
  empty?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-base-300 bg-base-100 p-4">
      <div className="flex items-center gap-1.5">
        <Icon className="size-3.5 text-base-content/40" />
        <p className="font-mono text-[10px] uppercase tracking-wider text-base-content/50">
          {label}
        </p>
      </div>
      {value != null ? (
        <p className="metric-value text-2xl font-semibold">{value}</p>
      ) : (
        <p className="metric-value text-2xl font-semibold text-base-content/25">
          ——
        </p>
      )}
      {delta}
      {sub}
      {value == null && empty ? (
        <p className="text-[11px] leading-snug text-base-content/45">{empty}</p>
      ) : null}
    </div>
  );
}

/** Avg-position delta: a *fall* in position number is the good direction. */
export function PositionDelta({
  current,
  previous,
}: {
  current: number | null | undefined;
  previous: number | null | undefined;
}) {
  if (current == null || previous == null || previous <= 0 || current <= 0) {
    return null;
  }
  const diff = current - previous;
  if (Math.abs(diff) < 0.01) {
    return (
      <p className="mt-1.5 inline-flex items-center gap-1 self-start rounded-full bg-base-200 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-base-content/50">
        — flat
      </p>
    );
  }
  const better = diff < 0;
  return (
    <p
      className={`mt-1.5 inline-flex items-center gap-1 self-start rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${
        better ? "bg-success/10 text-success" : "bg-error/10 text-error"
      }`}
    >
      {better ? "▼" : "▲"} {Math.abs(diff).toFixed(1)}
    </p>
  );
}

export function RankBucketsBar({
  buckets,
}: {
  buckets: { top3: number; p4to10: number; p11to50: number; p51plus: number };
}) {
  const total = buckets.top3 + buckets.p4to10 + buckets.p11to50 + buckets.p51plus;
  if (total === 0) return null;
  const segments = [
    { count: buckets.top3, tone: "bg-success" },
    { count: buckets.p4to10, tone: "bg-cyan" },
    { count: buckets.p11to50, tone: "bg-warning" },
    { count: buckets.p51plus, tone: "bg-base-content/25" },
  ] as const;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-base-200">
        {segments.map((segment, index) =>
          segment.count > 0 ? (
            <div
              key={index}
              className={segment.tone}
              style={{ width: `${(segment.count / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {segments.map((segment, index) => (
          <span
            key={index}
            className="flex items-center gap-1 font-mono text-[10px] tabular-nums text-base-content/50"
          >
            <span className={`size-1.5 rounded-full ${segment.tone}`} />
            {segment.count}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Hero stat row: clicks / impressions / avg position from the first-party
 * GSC trend, plus the backlink-snapshot and rank-distribution tiles. Values
 * degrade gracefully into setup hints when the underlying source isn't
 * connected yet.
 */
export function DashboardHeroGrid({
  projectId,
  dateRange,
  backlinks,
}: {
  projectId: string;
  dateRange: SearchPerformanceDateRange;
  backlinks: DashboardBacklinkSummary | null;
}) {
  const trendQuery = useQuery({
    queryKey: ["organicTrend", projectId, dateRange],
    queryFn: () => getOrganicTrend({ data: { projectId, dateRange } }),
  });
  const distributionQuery = useQuery({
    queryKey: ["rankPositionDistribution", projectId],
    queryFn: () => getRankPositionDistribution({ data: { projectId } }),
  });

  const trend = trendQuery.data;
  const totals = trend?.connected ? trend.totals : null;
  const prevTotals = trend?.connected ? trend.prevTotals : null;
  const distribution = distributionQuery.data;

  return (
    <div
      className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
      aria-busy={trendQuery.isPending}
    >
      <HeroTile
        icon={MousePointerClick}
        label="Clicks"
        value={totals ? formatCount(totals.clicks) : null}
        delta={
          totals && prevTotals ? (
            <PercentDelta current={totals.clicks} previous={prevTotals.clicks} />
          ) : null
        }
        empty="Connect Search Console to see organic clicks."
      />
      <HeroTile
        icon={Eye}
        label="Impressions"
        value={totals ? formatCount(totals.impressions) : null}
        delta={
          totals && prevTotals ? (
            <PercentDelta
              current={totals.impressions}
              previous={prevTotals.impressions}
            />
          ) : null
        }
        empty="Connect Search Console to see impressions."
      />
      <HeroTile
        icon={Gauge}
        label="Avg position"
        value={totals ? formatPosition(totals.position) : null}
        delta={
          totals && prevTotals ? (
            <PositionDelta current={totals.position} previous={prevTotals.position} />
          ) : null
        }
        empty="Connect Search Console to see positions."
      />
      <HeroTile
        icon={Globe}
        label="Ref. domains"
        value={
          backlinks?.referringDomains != null
            ? backlinks.referringDomains.toLocaleString()
            : null
        }
        sub={
          backlinks?.backlinks != null ? (
            <p className="font-mono text-[10px] tabular-nums text-base-content/45">
              {backlinks.backlinks.toLocaleString()} total links
            </p>
          ) : null
        }
        empty="Set a domain to snapshot your link profile."
      />
      <HeroTile
        icon={TrendingUp}
        label="Ranked keywords"
        value={
          distribution?.buckets
            ? `${distribution.positioned}/${distribution.tracked}`
            : null
        }
        sub={distribution?.buckets ? <RankBucketsBar buckets={distribution.buckets} /> : null}
        empty={
          distribution && distribution.tracked === 0 ? (
            <Link
              to="/p/$projectId/rank-tracking"
              params={{ projectId }}
              className="link link-primary text-[11px]"
            >
              Configure rank tracking →
            </Link>
          ) : undefined
        }
      />
    </div>
  );
}