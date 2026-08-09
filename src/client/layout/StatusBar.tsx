import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Bot, Search, Wallet, WifiOff } from "lucide-react";
import {
  getAgentConnectivity,
  getDataforseoBalance,
} from "@/serverFunctions/observability";

function isMac() {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform ?? "")
  );
}

function formatMoney(value: number | null | undefined): string {
  if (value == null) return "—";
  return `$${value.toFixed(2)}`;
}

/**
 * Thin status strip above the content panel — the always-available command
 * trigger plus live account/agent status pills. Pure additive UI; all reads
 * come through server functions that never bill DataForSEO.
 */
export function StatusBar({
  onOpenCommandPalette,
}: {
  onOpenCommandPalette: () => void;
}) {
  const balanceQuery = useQuery({
    queryKey: ["dataforseoBalance"],
    queryFn: () => getDataforseoBalance(),
    refetchInterval: 60_000,
  });
  const connectivityQuery = useQuery({
    queryKey: ["agentConnectivity"],
    queryFn: () => getAgentConnectivity(),
  });

  const balance = balanceQuery.data;
  const connectivity = connectivityQuery.data;

  const mcpOk = connectivity?.mcpAuthorized === true;
  const aiOk = connectivity?.aiConfigured === true;

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-base-300 bg-base-100 px-3 md:px-4">
      <button
        type="button"
        onClick={onOpenCommandPalette}
        className="group flex min-w-0 flex-1 items-center gap-2 rounded-md border border-base-300 bg-base-200/60 px-2.5 py-1 text-left transition-colors hover:border-base-content/30 md:max-w-sm"
        aria-label="Open command palette"
      >
        <Search className="size-3.5 shrink-0 text-base-content/40" />
        <span className="truncate text-xs text-base-content/45">
          Search or jump to…
        </span>
        <kbd className="ml-auto hidden shrink-0 rounded border border-base-300 bg-base-100 px-1.5 py-0.5 font-mono text-[10px] text-base-content/50 group-hover:text-base-content/70 sm:block">
          {isMac() ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {connectivity ? (
          <>
            <Link
              to="/ai"
              className={`flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-mono uppercase tracking-wider ${
                mcpOk
                  ? "border-success/25 bg-success/10 text-success"
                  : "border-warning/25 bg-warning/10 text-warning hover:border-warning/40"
              }`}
              title={
                mcpOk
                  ? "Agent authorized — MCP server connected"
                  : "Connect your agent via AI & MCP"
              }
            >
              <Bot className="size-3" />
              {mcpOk ? "MCP" : "MCP off"}
            </Link>
            <span
              className={`flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-mono uppercase tracking-wider ${
                aiOk
                  ? "border-cyan/25 bg-cyan/10 text-cyan"
                  : "border-base-300 bg-base-200 text-base-content/40"
              }`}
              title={aiOk ? "AI agent ready" : "No AI provider key configured"}
            >
              {aiOk ? (
                <>
                  <ArrowUpRight className="size-3" />
                  AI
                </>
              ) : (
                <>
                  <WifiOff className="size-3" />
                  AI off
                </>
              )}
            </span>
          </>
        ) : (
          <span className="flex h-6 items-center gap-1.5 rounded-full border border-base-300 bg-base-200 px-2.5 text-[10px] font-mono uppercase tracking-wider text-base-content/40">
            <WifiOff className="size-3" />
            agent
          </span>
        )}

        <span
          className="flex h-6 items-center gap-1.5 rounded-full border border-base-300 bg-base-200 px-2.5 text-[10px] font-mono uppercase tracking-wider text-base-content/50"
          title="DataForSEO account balance"
        >
          <Wallet className="size-3 text-primary/80" />
          <span className="tabular-nums">
            {balance && balance.balance != null
              ? formatMoney(balance.balance)
              : "——"}
          </span>
        </span>
      </div>
    </div>
  );
}
