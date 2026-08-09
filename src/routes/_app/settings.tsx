import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AiTab } from "@/client/features/settings/AiTab";
import { DataforseoTab } from "@/client/features/settings/DataforseoTab";
import { GeneralTab } from "@/client/features/settings/GeneralTab";
import {
  DEFAULT_FORM,
  type FormSettingsState,
} from "@/client/features/settings/settingsTypes";
import { TabButton } from "@/client/features/settings/SettingsUi";
import { useThemePreference } from "@/client/lib/theme";
import { authClient, useSession } from "@/lib/auth-client";
import { isHostedClientAuthMode } from "@/lib/auth-mode";
import { getAppSettings, saveAppSettings } from "@/serverFunctions/settings";
import type { PublicAppSettings } from "@/server/features/settings/appSettingsSchema";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

type Tab = "general" | "dataforseo" | "ai";

function SettingsPage() {
  const isHosted = isHostedClientAuthMode();
  const queryClient = useQueryClient();
  const { themePreference, setThemePreference } = useThemePreference();
  const { data: session, isPending: isSessionPending } = useSession();
  const [isSaving, setIsSaving] = useState(false);

  const [tab, setTab] = useState<Tab>("general");
  const [form, setForm] = useState<FormSettingsState>(DEFAULT_FORM);
  const [publicSettings, setPublicSettings] =
    useState<PublicAppSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [usageRefreshToken, setUsageRefreshToken] = useState(0);

  const setDataforseo = (patch: Partial<FormSettingsState["dataforseo"]>) =>
    setForm((f) => ({ ...f, dataforseo: { ...f.dataforseo, ...patch } }));
  const setAi = (patch: Partial<FormSettingsState["ai"]>) =>
    setForm((f) => ({ ...f, ai: { ...f.ai, ...patch } }));
  const setBranding = (patch: Partial<FormSettingsState["branding"]>) =>
    setForm((f) => ({ ...f, branding: { ...f.branding, ...patch } }));

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(false);
    getAppSettings()
      .then((settings) => {
        if (cancelled) return;
        setPublicSettings(settings);
        setForm((f) => ({
          ...f,
          dataforseo: {
            credentials: settings.dataforseo.credentials.map(
              (credential) => ({
                id: credential.id,
                login: credential.login,
                password: "",
              }),
            ),
          },
          ai: {
            ...f.ai,
            defaultModel: settings.ai.defaultModel,
            temperature: settings.ai.temperature,
            maxTokens: settings.ai.maxTokens,
          },
          branding: settings.branding,
        }));
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true);
          toast.error("Could not load settings.");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  const analyticsEnabled = session?.user?.analyticsOptedOut !== true;

  async function updateAnalyticsPreference(enabled: boolean) {
    setIsSaving(true);
    try {
      const result = await authClient.updateUser({
        analyticsOptedOut: !enabled,
      });
      if (result.error) {
        toast.error("We couldn't update your analytics setting.");
      } else {
        toast.success(enabled ? "Analytics enabled" : "Analytics disabled");
      }
    } catch {
      toast.error("We couldn't update your analytics setting.");
    } finally {
      setIsSaving(false);
    }
  }

  async function saveAll() {
    setIsSaving(true);
    try {
      const saved = await saveAppSettings({
        data: {
          ...form,
          expectedUpdatedAt: publicSettings?.updatedAt ?? null,
        },
      });
      setPublicSettings(saved);
      setForm((current) => ({
        ...current,
        dataforseo: {
          credentials: saved.dataforseo.credentials.map((credential) => ({
            id: credential.id,
            login: credential.login,
            password: "",
          })),
        },
        ai: {
          ...current.ai,
          defaultModel: saved.ai.defaultModel,
          temperature: saved.ai.temperature,
          maxTokens: saved.ai.maxTokens,
        },
        branding: saved.branding,
      }));
      setUsageRefreshToken((value) => value + 1);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["seoApiKeyStatus"] }),
        queryClient.invalidateQueries({ queryKey: ["samAccessStatus"] }),
        queryClient.invalidateQueries({ queryKey: ["dataforseoBalance"] }),
        queryClient.invalidateQueries({ queryKey: ["agentConnectivity"] }),
        queryClient.invalidateQueries({ queryKey: ["appBranding"] }),
      ]);
      toast.success("Settings saved. Changes apply immediately.");
    } catch {
      toast.error("Could not save settings.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="h-full overflow-auto bg-base-100 px-4 py-8 pb-24 md:px-6 md:py-12 md:pb-8">
      <div className="mx-auto max-w-2xl space-y-8">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-base-content/50">
            <Loader2 className="size-4 animate-spin" />
            Loading settings…
          </div>
        ) : loadError ? (
          <div
            role="alert"
            className="space-y-3 rounded-box border border-error/30 bg-error/10 p-4 text-sm"
          >
            <p className="font-medium">Settings could not be loaded.</p>
            <p className="text-base-content/70">
              Reload the settings data before making changes so existing values
              cannot be overwritten by defaults.
            </p>
            <button
              type="button"
              className="btn btn-error btn-sm"
              onClick={() => setLoadAttempt((value) => value + 1)}
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            <div role="tablist" className="tabs tabs-border w-full">
              <TabButton
                active={tab === "general"}
                label="General"
                onClick={() => setTab("general")}
              />
              <TabButton
                active={tab === "dataforseo"}
                label="DataForSEO"
                onClick={() => setTab("dataforseo")}
              />
              <TabButton
                active={tab === "ai"}
                label="AI & Models"
                onClick={() => setTab("ai")}
              />
            </div>

            {tab === "general" ? (
              <GeneralTab
                isHosted={isHosted}
                isSessionPending={isSessionPending}
                isSaving={isSaving}
                analyticsEnabled={analyticsEnabled}
                themePreference={themePreference}
                onThemeChange={setThemePreference}
                onAnalyticsChange={(enabled) =>
                  void updateAnalyticsPreference(enabled)
                }
                form={form}
                setBranding={setBranding}
                onSave={() => void saveAll()}
              />
            ) : null}

            {tab === "dataforseo" ? (
              <DataforseoTab
                configured={publicSettings?.dataforseo.configured ?? false}
                envConfigured={publicSettings?.dataforseo.envConfigured ?? false}
                form={form.dataforseo}
                setDataforseo={setDataforseo}
                isSaving={isSaving}
                refreshToken={usageRefreshToken}
                onSave={() => void saveAll()}
              />
            ) : null}

            {tab === "ai" ? (
              <AiTab
                configured={{
                  openrouter: publicSettings?.ai.openrouterConfigured ?? false,
                  openai: publicSettings?.ai.openaiConfigured ?? false,
                  anthropic: publicSettings?.ai.anthropicConfigured ?? false,
                }}
                form={form.ai}
                setAi={setAi}
                isSaving={isSaving}
                onSave={() => void saveAll()}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
