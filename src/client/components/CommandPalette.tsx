import * as React from "react";
import { useNavigate, type LinkOptions } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bookmark,
  CornerDownLeft,
  HelpCircle,
  Moon,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import { connectNavGroup, getProjectNavGroups } from "@/client/navigation/items";
import { getProjects } from "@/serverFunctions/projects";
import { useThemePreference } from "@/client/lib/theme";
import { signOutAndRedirect } from "@/lib/auth-client";
import { isHostedClientAuthMode } from "@/lib/auth-mode";
import type { ComponentType } from "react";

type PaletteEntry = {
  id: string;
  group: string;
  label: string;
  hint: string;
  link?: LinkOptions;
  action?: () => void;
  icon: ComponentType<{ className?: string }>;
};

const rowClasses = (isActive: boolean) =>
  `-ml-1 flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm ${
    isActive ? "bg-primary/15 text-base-content" : "text-base-content/70"
  }`;

/**
 * ⌘K command palette. Global key listener + query filtering over the sidebar
 * nav, projects, and a few quick actions. Hand-rolled on purpose: the app's
 * nav items are typed LinkOptions, so routing through them keeps every search
 * param and active-state rule intact.
 */
export function CommandPalette({
  projectId,
  onClose,
}: {
  projectId: string | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => getProjects(),
  });
  const { setThemePreference } = useThemePreference();

  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const [query, setQuery] = React.useState("");
  const [highlight, setHighlight] = React.useState(0);

  const entries = React.useMemo<PaletteEntry[]>(() => {
    const result: PaletteEntry[] = [];
    if (projectId) {
      for (const group of [
        ...getProjectNavGroups(projectId),
        connectNavGroup,
      ]) {
        for (const item of group.items) {
          const { icon, label, ...linkProps } = item;
          result.push({
            id: `page:${group.label}:${label}`,
            group: "Pages",
            label,
            hint: "open",
            link: linkProps,
            icon,
          });
        }
      }
      result.push({
        id: "page:Settings",
        group: "Pages",
        label: "Settings",
        hint: "open",
        link: { to: "/settings" },
        icon: Settings,
      });
    }
    result.push({
      id: "page:Help",
      group: "Pages",
      label: "Help & Community",
      hint: "open",
      link: { to: "/support" },
      icon: HelpCircle,
    });

    for (const project of projectsQuery.data ?? []) {
      result.push({
        id: `project:${project.id}`,
        group: "Projects",
        label: project.name,
        hint: project.domain ?? "switch",
        link: {
          to: "/p/$projectId",
          params: { projectId: project.id },
          search: {},
        },
        icon: Bookmark,
      });
    }

    const isHosted = isHostedClientAuthMode();
    if (isHosted) {
      result.push({
        id: "action:theme-dark",
        group: "Actions",
        label: "Dark theme",
        hint: "appearance",
        action: () => setThemePreference("dark"),
        icon: Moon,
      });
      result.push({
        id: "action:theme-light",
        group: "Actions",
        label: "Light theme",
        hint: "appearance",
        action: () => setThemePreference("light"),
        icon: Sun,
      });
      result.push({
        id: "action:signout",
        group: "Actions",
        label: "Sign out",
        hint: "session",
        action: () => {
          signOutAndRedirect();
        },
        icon: Search,
      });
    }

    return result;
  }, [projectId, projectsQuery.data, setThemePreference]);

  const normalized = query.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    if (!normalized) return entries;
    const scored = entries
      .map((entry) => {
        const haystack = `${entry.group} ${entry.label} ${entry.hint}`.toLowerCase();
        let score = -1;
        if (haystack.startsWith(normalized)) score = 100;
        else if (haystack.includes(normalized)) score = 50;
        else if (entry.label.toLowerCase().includes(normalized)) score = 25;
        return { entry, score } as const;
      })
      .filter(({ score }) => score >= 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.map(({ entry }) => entry);
  }, [entries, normalized]);

  React.useEffect(() => {
    setHighlight(0);
  }, [query]);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const run = (entry: PaletteEntry) => {
    onClose();
    if (entry.action) {
      entry.action();
      return;
    }
    if (entry.link) {
      void navigate(entry.link);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = filtered[highlight];
      if (entry) run(entry);
    }
  };

  React.useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>("[data-highlighted]");
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const groups = React.useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const entry of filtered) {
      if (!seen.has(entry.group)) {
        seen.add(entry.group);
        ordered.push(entry.group);
      }
    }
    return ordered;
  }, [filtered]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={onClose}
      onKeyDown={onKeyDown}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-2xl shadow-primary/10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-base-300 px-4">
          <Search className="size-4 shrink-0 text-base-content/40" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pages, projects, actions…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-base-content/35"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-results"
          />
          <kbd className="rounded-md border border-base-300 bg-base-200 px-1.5 py-0.5 font-mono text-[10px] text-base-content/50">
            esc
          </kbd>
        </div>

        <div
          ref={listRef}
          id="command-palette-results"
          className="max-h-[46vh] overflow-y-auto p-2"
          role="listbox"
          aria-label="Commands"
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-base-content/50">
              No results for &ldquo;{query}&rdquo;
            </p>
          ) : (
            groups.map((group) => {
              const groupEntries = filtered.filter(
                (entry) => entry.group === group,
              );
              const baseIndex = filtered.indexOf(groupEntries[0]);
              return (
                <div key={group}>
                  <p className="micro-label px-3 pb-1 pt-2">{group}</p>
                  {groupEntries.map((entry) => {
                    const index = baseIndex + groupEntries.indexOf(entry);
                    const isActive = index === highlight;
                    const Icon = entry.icon;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        data-highlighted={isActive || undefined}
                        onClick={() => run(entry)}
                        className={rowClasses(isActive)}
                      >
                        <Icon
                          className={`size-4 shrink-0 ${isActive ? "text-primary" : "text-base-content/40"}`}
                        />
                        <span className="flex-1 truncate">{entry.label}</span>
                        <span className="micro-label text-base-content/30">
                          {entry.hint}
                        </span>
                        {isActive ? (
                          <CornerDownLeft className="size-3.5 shrink-0 text-primary/70" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-base-300 bg-base-200/60 px-4 py-2">
          <span className="micro-label flex items-center gap-1.5">
            <kbd className="rounded border border-base-300 bg-base-100 px-1 py-0.5">
              ↑↓
            </kbd>
            navigate
          </span>
          <span className="micro-label flex items-center gap-1.5">
            <kbd className="rounded border border-base-300 bg-base-100 px-1 py-0.5">
              ↵
            </kbd>
            open
          </span>
          <span className="micro-label ml-auto">AbbaSeo command palette</span>
        </div>
      </div>
    </div>
  );
}