import { Eye, EyeOff } from "lucide-react";
import type { ReactNode } from "react";

export function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-box border border-base-300 bg-base-200/40 p-4">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-base-content/60">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`tab flex-1 gap-1.5 ${active ? "tab-active" : ""}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function SecretField({
  label,
  value,
  onChange,
  placeholder,
  revealed,
  onToggleReveal,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  revealed: boolean;
  onToggleReveal: () => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type={revealed ? "text" : "password"}
          className="input input-bordered w-full"
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <button
          type="button"
          className="btn btn-ghost btn-square btn-sm shrink-0"
          aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
          onClick={onToggleReveal}
        >
          {revealed ? (
            <EyeOff className="size-4" />
          ) : (
            <Eye className="size-4" />
          )}
        </button>
      </span>
    </label>
  );
}

export function SliderField(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  displayValue: string;
  onChange: (value: number) => void;
}) {
  const { label, min, max, step, value, displayValue, onChange } = props;
  return (
    <label className="block space-y-2">
      <span className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-xs text-base-content/60">
          {displayValue}
        </span>
      </span>
      <input
        type="range"
        className="range range-primary range-xs w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}
