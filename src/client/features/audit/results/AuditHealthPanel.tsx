import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { getIssueDescriptor } from "@/shared/audit-issues";
import { resolveIssueSeverity } from "@/client/features/audit/results/IssuesView";
import type { AuditResultsData } from "@/client/features/audit/results/types";

type AuditIssueRow = AuditResultsData["issues"][number];
type SeverityKey = "critical" | "warning" | "info";

const SEVERITY_WEIGHT: Record<SeverityKey, number> = {
  critical: 8,
  warning: 3,
  info: 0.5,
};

const SEVERITY_ACCENT: Record<SeverityKey, string> = {
  critical: "bg-error",
  warning: "bg-warning",
  info: "bg-info",
};

const SEVERITY_TEXT: Record<SeverityKey, string> = {
  critical: "text-error",
  warning: "text-warning",
  info: "text-info",
};

const SEVERITY_LABEL: Record<SeverityKey, string> = {
  critical: "Critical",
  warning: "Warnings",
  info: "Notices",
};

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreTone(score: number): string {
  if (score >= 90) return "text-success";
  if (score >= 70) return "text-warning";
  return "text-error";
}

function scoreRingColor(score: number): string {
  if (score >= 90) return "var(--color-success)";
  if (score >= 70) return "var(--color-warning)";
  return "var(--color-error)";
}

function healthLabel(score: number): string {
  if (score >= 90) return "Healthy";
  if (score >= 70) return "Needs work";
  return "Critical issues";
}

type IssueSummaries = {
  score: number;
  counts: Record<SeverityKey, number>;
  groupsBySeverity: Record<
    SeverityKey,
    { issueType: string; title: string; count: number }[]
  >;
};

/** Severity-weighted score + per-severity category groups, memoized upstream. */
function summarizeIssues(issues: AuditIssueRow[]): IssueSummaries {
  const groups: Record<
    SeverityKey,
    { issueType: string; title: string; count: number }[]
  > = {
    critical: [],
    warning: [],
    info: [],
  };
  const counts: Record<SeverityKey, number> = {
    critical: 0,
    warning: 0,
    info: 0,
  };
  let weight = 0;

  for (const issue of issues) {
    const severity = resolveIssueSeverity(issue);
    counts[severity] += 1;
    weight += SEVERITY_WEIGHT[severity];
    const bucket = groups[severity];
    const existing = bucket.find(
      (candidate) => candidate.issueType === issue.issueType,
    );
    if (existing) {
      existing.count += 1;
    } else {
      const descriptor = getIssueDescriptor(issue.issueType);
      bucket.push({
        issueType: issue.issueType,
        title: descriptor?.title ?? issue.issueType,
        count: 1,
      });
    }
  }

  for (const bucket of Object.values(groups)) {
    bucket.toSorted((a, b) => b.count - a.count);
  }

  return {
    score: clampScore(100 - weight),
    counts,
    groupsBySeverity: groups,
  };
}

/** SVG ring gauge: dasharray sweeps the ring by the health score. */
function HealthGauge({ score }: { score: number }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);
  const stroke = scoreRingColor(score);
  return (
    <div className="relative mx-auto size-32">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="color-mix(in oklab, var(--color-base-content) 10%, transparent)"
          strokeWidth="10"
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`metric-value text-3xl font-semibold ${scoreTone(score)}`}>
          {score}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-base-content/45">
          / 100
        </span>
      </div>
    </div>
  );
}

/**
 * Audit health summary inserted between the stats strip and the results card:
 * a severity-weighted ring gauge plus per-category meters filtered by a
 * Critical / Warnings / Notices tab. Purely presentational — zero issue rows,
 * no server calls.
 */
export function AuditHealthPanel({
  issues,
  onShowIssues,
}: {
  issues: AuditIssueRow[];
  onShowIssues: () => void;
}) {
  const [activeSeverity, setActiveSeverity] = useState<SeverityKey>("critical");

  const { score, counts, groupsBySeverity } = useMemo(
    () => summarizeIssues(issues),
    [issues],
  );

  const activeGroups = groupsBySeverity[activeSeverity];
  const maxCount = activeGroups[0]?.count ?? 0;

  return (
    <div className="grid items-center gap-5 rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm lg:grid-cols-[minmax(0,14rem)_1fr]">
      <div className="flex flex-col items-center gap-1.5">
        <HealthGauge score={score} />
        <p className="text-sm font-medium">{healthLabel(score)}</p>
        <p className="font-mono text-[10px] uppercase tracking-wider text-base-content/45">
          {issues.length} {issues.length === 1 ? "issue" : "issues"} ·{" "}
          {counts.critical} critical
        </p>
      </div>

      <div className="min-w-0">
        <div
          role="tablist"
          aria-label="Filter issues by severity"
          className="flex items-center gap-0.5 rounded-md border border-base-300 bg-base-200/60 p-0.5"
        >
          {(["critical", "warning", "info"] as const).map((severity) => (
            <button
              key={severity}
              type="button"
              role="tab"
              aria-selected={activeSeverity === severity}
              onClick={() => setActiveSeverity(severity)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                activeSeverity === severity
                  ? `${SEVERITY_TEXT[severity]} bg-base-100 shadow-sm`
                  : "text-base-content/45 hover:text-base-content/70"
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${SEVERITY_ACCENT[severity]} ${
                  counts[severity] === 0 ? "opacity-30" : ""
                }`}
              />
              {SEVERITY_LABEL[severity]}
              <span className="tabular-nums">{counts[severity]}</span>
            </button>
          ))}
        </div>

        {activeGroups.length === 0 ? (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-success/25 bg-success/5 px-3 py-2.5 text-sm text-success">
            No {SEVERITY_LABEL[activeSeverity].toLowerCase()} — this category
            is clean.
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {activeGroups.slice(0, 6).map((group) => (
              <li key={group.issueType}>
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className="truncate text-sm text-base-content/80"
                    title={group.title}
                  >
                    {group.title}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-base-content/50">
                    {group.count} {group.count === 1 ? "page" : "pages"}
                  </span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-base-300/50">
                  <div
                    className={`h-full rounded-full ${SEVERITY_ACCENT[activeSeverity]}`}
                    style={{
                      width: `${maxCount ? Math.max(6, (group.count / maxCount) * 100) : 0}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={onShowIssues}
          className="mt-4 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-primary hover:text-primary/80"
        >
          Open in issues view <ArrowRight className="size-3" />
        </button>
      </div>
    </div>
  );
}