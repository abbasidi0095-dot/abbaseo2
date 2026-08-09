import { Loader2, Monitor, Moon, Sun } from "lucide-react";
import { SectionCard } from "@/client/features/settings/SettingsUi";
import { type ThemePreference } from "@/client/lib/theme";
import type { FormSettingsState } from "@/client/features/settings/settingsTypes";
import { version } from "../../../../package.json";

const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  icon: typeof Sun;
}[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

const REGION_OPTIONS = [
  { value: "US", label: "United States" },
  { value: "UK", label: "United Kingdom" },
  { value: "FR", label: "France" },
  { value: "DE", label: "Germany" },
  { value: "ES", label: "Spain" },
  { value: "IT", label: "Italy" },
  { value: "NL", label: "Netherlands" },
  { value: "CA", label: "Canada" },
  { value: "AU", label: "Australia" },
  { value: "JP", label: "Japan" },
  { value: "IN", label: "India" },
  { value: "BR", label: "Brazil" },
  { value: "MX", label: "Mexico" },
];

const CURRENCY_OPTIONS = [
  { value: "USD", label: "USD — US Dollar" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — British Pound" },
];

export function GeneralTab(props: {
  isHosted: boolean;
  isSessionPending: boolean;
  isSaving: boolean;
  analyticsEnabled: boolean;
  themePreference: ThemePreference;
  onThemeChange: (preference: ThemePreference) => void;
  onAnalyticsChange: (enabled: boolean) => void;
  form: FormSettingsState;
  setBranding: (patch: Partial<FormSettingsState["branding"]>) => void;
  onSave: () => void;
}) {
  const {
    isHosted,
    isSessionPending,
    isSaving,
    analyticsEnabled,
    themePreference,
    onThemeChange,
    onAnalyticsChange,
    form,
    setBranding,
    onSave,
  } = props;

  return (
    <div className="space-y-6">
      <SectionCard
        title="Branding & Preferences"
        description="Deployment-wide identity and defaults."
      >
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Application Title</span>
          <input
            className="input input-bordered w-full"
            value={form.branding.appTitle}
            onChange={(event) =>
              setBranding({ appTitle: event.currentTarget.value })
            }
          />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Default Target Region</span>
            <select
              className="select select-bordered w-full"
              value={form.branding.defaultRegion}
              onChange={(event) =>
                setBranding({ defaultRegion: event.currentTarget.value })
              }
            >
              {REGION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Currency</span>
            <select
              className="select select-bordered w-full"
              value={form.branding.currency}
              onChange={(event) =>
                setBranding({ currency: event.currentTarget.value })
              }
            >
              {CURRENCY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={isSaving}
            onClick={onSave}
          >
            {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
            Save Preferences
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Appearance">
        <div className="flex items-center justify-between gap-6">
          <span className="text-sm">Theme</span>
          <div
            role="radiogroup"
            aria-label="Theme preference"
            className="flex gap-0.5 rounded-lg bg-base-200 p-0.5"
          >
            {THEME_OPTIONS.map((option) => {
              const isActive = option.value === themePreference;
              const Icon = option.icon;

              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  aria-label={option.label}
                  className={`flex cursor-pointer items-center justify-center rounded-md px-3 py-1.5 transition-colors ${
                    isActive
                      ? "bg-base-100 text-base-content shadow-sm"
                      : "text-base-content/50 hover:text-base-content/80"
                  }`}
                  onClick={() => onThemeChange(option.value)}
                >
                  <Icon className="size-4" />
                </button>
              );
            })}
          </div>
        </div>
      </SectionCard>

      {isHosted ? (
        <SectionCard title="Analytics">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-sm">Help improve AbbaSeo</p>
              <p className="mt-1 text-sm text-base-content/60">
                Share analytics and usage data.
              </p>
            </div>
            <input
              type="checkbox"
              className="toggle toggle-primary"
              checked={analyticsEnabled}
              disabled={isSessionPending || isSaving}
              onChange={(event) =>
                onAnalyticsChange(event.currentTarget.checked)
              }
              aria-label="Enable product analytics"
            />
          </div>
        </SectionCard>
      ) : (
        <SectionCard title="About">
          <div className="flex items-center justify-between gap-6">
            <span className="text-sm">Version</span>
            <span className="font-mono text-sm text-base-content/60">
              v{version}
            </span>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
