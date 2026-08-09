// Shared building blocks for the dashboard cards. Same visual language as
// the GSC IntegrationCard (rounded-xl, shadow-sm, header row + divider) so
// the embedded SearchConsoleConnectionCard doesn't read as a different
// design system.
export function CardShell({
  title,
  stamp,
  action,
  children,
}: {
  title: string;
  stamp?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-sm">
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight text-base-content">
          {title}
        </h2>
        {action}
      </div>
      <div className="border-t border-base-300 p-4">
        {children}
        {stamp ? (
          <p className="mt-4 font-mono text-[10px] uppercase tracking-wider text-base-content/45">
            {stamp}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyCardBody({
  message,
  cta,
}: {
  message: string;
  cta: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-base-content/70">{message}</p>
      {cta}
    </div>
  );
}

export function Stat({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone?: "success" | "error";
  sub?: React.ReactNode;
}) {
  const toneClass =
    tone === "success" ? "text-success" : tone === "error" ? "text-error" : "";
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wider text-base-content/50">
        {label}
      </p>
      <p className={`text-2xl font-semibold tabular-nums ${toneClass}`}>
        {value}
      </p>
      {sub}
    </div>
  );
}

export function PercentDelta({
  current,
  previous,
}: {
  current: number;
  previous: number;
}) {
  if (previous <= 0) return null;
  const pct = ((current - previous) / previous) * 100;
  if (!Number.isFinite(pct)) return null;
  const rounded = Math.round(pct);
  const tone =
    rounded > 0
      ? "bg-success/10 text-success"
      : rounded < 0
        ? "bg-error/10 text-error"
        : "bg-base-200 text-base-content/50";
  const arrow = rounded > 0 ? "▲" : rounded < 0 ? "▼" : "—";
  return (
    <p
      className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${tone}`}
    >
      {arrow} {Math.abs(rounded)}%
    </p>
  );
}

export const moreDetailsClass =
  "btn btn-ghost btn-xs font-mono text-[10px] uppercase tracking-wider text-base-content/50";

export function newLost(value: number | null): string {
  return value === null ? "—" : String(value);
}

export function formatDay(timestamp: string): string {
  const ms = Date.parse(
    // SQLite's current_timestamp default has no timezone marker; treat it as
    // UTC rather than letting the browser parse it as local time.
    /^\d{4}-\d{2}-\d{2} /.test(timestamp)
      ? `${timestamp.replace(" ", "T")}Z`
      : timestamp,
  );
  if (Number.isNaN(ms)) return timestamp;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
