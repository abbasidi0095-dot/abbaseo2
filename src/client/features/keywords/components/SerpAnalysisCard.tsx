import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { ExportToSheetsButton } from "@/client/components/table/ExportToSheetsButton";
import {
  formatCompactNumber,
  formatNumber,
} from "@/client/features/keywords/utils";
import type { SerpResultItem } from "@/types/keywords";

export function SerpAnalysisCard({
  items,
  keyword,
  loading,
  error,
  onRetry,
  page,
  pageSize,
  onPageChange,
}: {
  items: SerpResultItem[];
  keyword?: string | null;
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
}) {
  const totalPages = Math.ceil(items.length / pageSize);
  const pageItems = items.slice(page * pageSize, (page + 1) * pageSize);

  if (loading) return <SerpAnalysisLoadingState />;
  if (error) {
    return (
      <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error space-y-2">
        <p>{error}</p>
        {onRetry ? (
          <button className="btn btn-xs" onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>
    );
  }
  if (items.length === 0) return <SerpAnalysisEmptyState keyword={keyword} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-base-content/50">
          {items.length} organic results
        </div>
        <ExportToSheetsButton
          headers={["Rank", "Title", "URL", "Domain"]}
          rows={items.map((item) => [
            item.rank,
            item.title ?? "",
            item.url,
            item.domain,
          ])}
          feature="serp_analysis"
        />
      </div>
      <SerpAnalysisTable items={pageItems} />
      <SerpAnalysisPagination
        page={page}
        totalPages={totalPages}
        onPageChange={onPageChange}
      />
    </div>
  );
}

// Google's own SERP palette, fixed hexes so the preview reads as a literal
// results page regardless of the app theme (the container is always white).
const GOOGLE_TITLE = "#1a0dab";
const GOOGLE_DOMAIN = "#006621";
const GOOGLE_DESCRIPTION = "#4d5156";

function SerpChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-wide text-[#80868b]">
      {label}{" "}
      <span className="tabular-nums font-medium text-[#5f6368]">{value}</span>
    </span>
  );
}

function SerpAnalysisTable({ items }: { items: SerpResultItem[] }) {
  return (
    <ol
      className="divide-y divide-[#e8eaed] overflow-hidden rounded-lg border border-[#dadce0] bg-white shadow-sm"
      aria-label="Search results preview"
    >
      {items.map((item) => {
        const movedUp =
          item.rankChange != null && item.rankChange > 0;
        const movedDown =
          item.rankChange != null && item.rankChange < 0;
        return (
          <li key={`${item.rank}-${item.url}`} className="flex gap-3 px-4 py-3">
            <span className="w-5 shrink-0 pt-0.5 text-right font-mono text-[13px] font-medium tabular-nums text-[#70757a]">
              {item.rank}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-[15px] leading-snug hover:underline"
                  style={{ color: GOOGLE_TITLE }}
                  title={item.title}
                >
                  {item.title || item.domain || item.url}
                  <ExternalLink className="mb-0.5 ml-1 inline size-3 opacity-50" />
                </a>
                {item.isNew ? (
                  <span className="shrink-0 rounded bg-[#e6f4ea] px-1 py-px text-[10px] font-semibold text-[#137333]">
                    NEW
                  </span>
                ) : null}
                {movedUp ? (
                  <span className="shrink-0 rounded bg-[#e6f4ea] px-1 py-px font-mono text-[10px] font-semibold tabular-nums text-[#137333]">
                    ▲{formatNumber(item.rankChange)}
                  </span>
                ) : null}
                {movedDown ? (
                  <span className="shrink-0 rounded bg-[#fce8e6] px-1 py-px font-mono text-[10px] font-semibold tabular-nums text-[#d93025]">
                    ▼{formatNumber(Math.abs(item.rankChange ?? 0))}
                  </span>
                ) : null}
              </div>
              <p
                className="mt-0.5 truncate text-xs"
                style={{ color: GOOGLE_DOMAIN }}
              >
                {item.domain}
              </p>
              <p
                className="mt-1 line-clamp-2 text-[13px] leading-snug"
                style={{ color: GOOGLE_DESCRIPTION }}
              >
                {item.description}
              </p>
              {item.etv != null ||
              item.estimatedPaidTrafficCost != null ||
              item.backlinks != null ||
              item.referringDomains != null ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {item.etv != null ? (
                    <SerpChip label="ETV" value={formatCompactNumber(item.etv)} />
                  ) : null}
                  {item.estimatedPaidTrafficCost != null ? (
                    <SerpChip
                      label="Paid /mo"
                      value={`$${formatCompactNumber(item.estimatedPaidTrafficCost)}`}
                    />
                  ) : null}
                  {item.backlinks != null ? (
                    <SerpChip
                      label="Backlinks"
                      value={formatCompactNumber(item.backlinks)}
                    />
                  ) : null}
                  {item.referringDomains != null ? (
                    <SerpChip
                      label="Ref. domains"
                      value={formatCompactNumber(item.referringDomains)}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function SerpAnalysisPagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between mt-3 pt-3 border-t border-base-200">
      <span className="text-xs text-base-content/50">
        Page {page + 1} of {totalPages}
      </span>
      <div className="flex gap-1">
        <button
          className="btn btn-ghost btn-xs"
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="size-3.5" />
          Prev
        </button>
        <button
          className="btn btn-ghost btn-xs"
          disabled={page >= totalPages - 1}
          onClick={() => onPageChange(page + 1)}
        >
          Next
          <ChevronRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function SerpAnalysisLoadingState() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, index) => (
        <div
          key={index}
          className="h-8 rounded bg-base-200 animate-pulse"
          style={{ animationDelay: `${index * 50}ms` }}
        />
      ))}
    </div>
  );
}

function SerpAnalysisEmptyState({ keyword }: { keyword?: string | null }) {
  return (
    <div className="text-sm text-base-content/50 text-center py-8">
      <p>No SERP details available for this keyword yet.</p>
      {keyword ? (
        <p className="mt-1">Try clicking another keyword to load data.</p>
      ) : null}
    </div>
  );
}
