import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ActivationRepository } from "@/server/features/activation/repositories/ActivationRepository";
import { GscService } from "@/server/features/gsc/services/GscService";
import { resolveDateRange } from "@/server/features/gsc/searchAnalytics";
import { previousPeriod } from "@/server/features/gsc/searchPerformanceReport";
import { fetchUserData } from "@/server/lib/dataforseo/appendix";
import { RankTrackingRepository } from "@/server/features/rank-tracking/repositories/RankTrackingRepository";
import { getLatestResults } from "@/server/features/rank-tracking/services/rankTrackingResults";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { isDynamicSecretConfigured } from "@/server/features/settings/SettingsService";
import { dashboardProjectInputSchema } from "@/types/schemas/dashboard";
import { SEARCH_PERFORMANCE_RANGES } from "@/types/schemas/search-performance";

// ---------------------------------------------------------------------------
// UI-support observability reads. Additive plumbing for dashboard widgets —
// every call is free (no billable DataForSEO requests) and reuses existing
// services/repositories. Nothing here modifies existing handlers.
// ---------------------------------------------------------------------------

/**
 * Live account balance from DataForSEO's free GET /v3/appendix/user_data.
 * Powers the balance ticker in the status bar. Never billable; falls back to
 * null when the key is unset or the account is unreachable.
 */
export const getDataforseoBalance = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(async () => {
    try {
      const account = await fetchUserData();
      const money = account?.money;
      return {
        balance: money?.balance ?? null,
        total: money?.total ?? null,
        daySpend: money?.statistics?.day?.total ?? null,
        minuteSpend: money?.statistics?.minute?.total ?? null,
      };
    } catch {
      return null;
    }
  });

/**
 * Agent/AI connectivity pill: whether the org authorized the MCP server and
 * whether an OpenRouter key is configured (SAM agent availability).
 */
export const getAgentConnectivity = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    const activation = await ActivationRepository.getOrganizationActivation(
      context.organizationId,
    );
    const [seoDataConfigured, aiConfigured] = await Promise.all([
      isDynamicSecretConfigured("DATAFORSEO_API_KEY"),
      isDynamicSecretConfigured("OPENROUTER_API_KEY"),
    ]);
    return {
      mcpAuthorized: activation?.firstMcpAuthorizedAt != null,
      seoDataConfigured,
      aiConfigured,
    };
  });

const organicTrendInputSchema = dashboardProjectInputSchema.extend({
  dateRange: z.enum(SEARCH_PERFORMANCE_RANGES).default("last_28_days"),
});

type GscPerformanceRow = {
  keys?: string[];
  clicks: number;
  impressions: number;
  position: number;
};

type TrendTotals = {
  clicks: number;
  impressions: number;
  position: number;
};

function toTrendPoint(row: GscPerformanceRow) {
  return {
    date: row.keys?.[0] ?? "",
    clicks: row.clicks,
    impressions: row.impressions,
    position: row.position,
  };
}

function sumTrendTotals(rows: GscPerformanceRow[]): TrendTotals {
  return rows.reduce(
    (acc, row) => ({
      clicks: acc.clicks + row.clicks,
      impressions: acc.impressions + row.impressions,
      position:
        acc.impressions + row.impressions > 0
          ? (acc.position * acc.impressions + row.position * row.impressions) /
            (acc.impressions + row.impressions)
          : acc.position,
    }),
    { clicks: 0, impressions: 0, position: 0 },
  );
}

/**
 * Daily organic-traffic series from the connected Search Console property
 * (free first-party data). Returns per-day clicks/impressions/avg position
 * plus current/previous-period totals for the hero trend chart. Mirrors the
 * report function's connection-failure handling so the UI can prompt a
 * reconnect instead of erroring.
 */
export const getOrganicTrend = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(organicTrendInputSchema)
  .handler(async ({ data, context }) => {
    const { startDate, endDate } = resolveDateRange({
      dateRange: data.dateRange,
    });
    const prev = previousPeriod(startDate, endDate);

    try {
      const current = await GscService.getPerformance({
        projectId: context.projectId,
        startDate,
        endDate,
        dimensions: ["date"],
        filters: [],
        rowLimit: 200,
      });
      const previous = await GscService.getPerformance({
        projectId: context.projectId,
        startDate: prev.startDate,
        endDate: prev.endDate,
        dimensions: ["date"],
        filters: [],
        rowLimit: 200,
      });

      return {
        connected: true as const,
        series: current.rows.map(toTrendPoint),
        totals: sumTrendTotals(current.rows),
        prevTotals: sumTrendTotals(previous.rows),
      };
    } catch {
      return { connected: false as const };
    }
  });

/**
 * Keyword-position distribution for the hero stacked bar. Buckets the latest
 * rank-tracking positions (desktop + mobile, all active configs) into
 * top-3 / 4-10 / 11-50 / 51+. Empty when rank tracking has no data yet.
 */
export const getRankPositionDistribution = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(dashboardProjectInputSchema)
  .handler(async ({ context }) => {
    const configs = await RankTrackingRepository.getConfigsForProject(
      context.projectId,
    );
    if (configs.length === 0) {
      return { tracked: 0, positioned: 0, buckets: null, lastCheckedAt: null };
    }

    const buckets = { top3: 0, p4to10: 0, p11to50: 0, p51plus: 0 };
    let positioned = 0;
    let tracked = 0;
    let lastCheckedAt: string | null = null;

    for (const config of configs.slice(0, 5)) {
      const { rows, run } = await getLatestResults(
        config.id,
        context.projectId,
        "7d",
      );
      if (!lastCheckedAt && run?.lastCheckedAt) {
        lastCheckedAt = run.lastCheckedAt;
      }
      for (const row of rows) {
        for (const device of ["desktop", "mobile"] as const) {
          tracked += 1;
          const position = row[device].position;
          if (position == null) continue;
          positioned += 1;
          if (position <= 3) buckets.top3 += 1;
          else if (position <= 10) buckets.p4to10 += 1;
          else if (position <= 50) buckets.p11to50 += 1;
          else buckets.p51plus += 1;
        }
      }
    }

    return { tracked, positioned, buckets, lastCheckedAt };
  });
