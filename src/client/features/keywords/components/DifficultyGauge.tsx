import { scoreTierClass } from "@/client/features/keywords/utils";

// Bar ramp mirrors the badge tiers: easy = emerald, moderate = amber,
// hard = rose (light theme tones; on dark the badge text brightens, bar stays).
const TIER_BAR_CLASS: Record<string, string> = {
  "score-tier-1": "bg-emerald-500",
  "score-tier-2": "bg-lime-500",
  "score-tier-3": "bg-yellow-500",
  "score-tier-4": "bg-orange-500",
  "score-tier-5": "bg-red-500",
  "score-tier-6": "bg-red-600",
};

/**
 * Dense difficulty cell: a hairline gauge next to the familiar numbered
 * badge so a keywords column scans by bar length before reading digits.
 */
export function DifficultyGauge({ value }: { value: number | null }) {
  const tier = scoreTierClass(value);
  return (
    <span className="inline-flex items-center justify-end gap-2">
      {value != null ? (
        <span
          className="h-1 w-12 overflow-hidden rounded-full bg-base-300/60"
          aria-hidden
        >
          <span
            className={`block h-full rounded-full ${TIER_BAR_CLASS[tier] ?? "bg-base-300"}`}
            style={{ width: `${Math.max(4, value)}%` }}
          />
        </span>
      ) : null}
      <span
        className={`score-badge ${tier} inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums`}
      >
        {value == null ? "—" : value}
      </span>
    </span>
  );
}
