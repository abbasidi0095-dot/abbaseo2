import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  SectionCard,
  SecretField,
  SliderField,
} from "@/client/features/settings/SettingsUi";
import type { FormSettingsState } from "@/client/features/settings/settingsTypes";
import { TestResultBanner } from "@/client/features/settings/DataforseoTab";
import {
  getAiModelPresets,
  testAiConnection,
} from "@/serverFunctions/settings";
import { toast } from "sonner";

export function AiTab(props: {
  configured: {
    openrouter: boolean;
    openai: boolean;
    anthropic: boolean;
  };
  form: FormSettingsState["ai"];
  setAi: (patch: Partial<FormSettingsState["ai"]>) => void;
  isSaving: boolean;
  onSave: () => void;
}) {
  const { configured, form, setAi, isSaving, onSave } = props;
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  }>();
  const [modelPresets, setModelPresets] = useState<
    Array<{ label: string; value: string }>
  >([]);

  useEffect(() => {
    getAiModelPresets()
      .then(setModelPresets)
      .catch(() => {
        setModelPresets([]);
      });
  }, []);

  const toggleReveal = (key: string) =>
    setRevealed((r) => ({ ...r, [key]: !r[key] }));

  async function handleTest() {
    if (!form.openrouterApiKey) {
      toast.error("Enter your OpenRouter API key to test.");
      return;
    }
    if (!form.defaultModel) {
      toast.error("Pick a model first.");
      return;
    }
    setIsTesting(true);
    setTestResult(undefined);
    try {
      const result = await testAiConnection({
        data: {
          apiKey: form.openrouterApiKey,
          model: form.defaultModel,
          temperature: form.temperature,
          maxTokens: form.maxTokens,
        },
      });
      setTestResult(
        result.ok
          ? {
              ok: true,
              message: `Model responded in ${result.latencyMs} ms — ${result.echoed}`,
            }
          : { ok: false, message: result.message },
      );
    } catch {
      setTestResult({
        ok: false,
        message: "Could not run the AI test prompt.",
      });
    } finally {
      setIsTesting(false);
    }
  }

  return (
    <div className="space-y-6">
      <SectionCard
        title="AI & OpenRouter Configuration"
        description="The in-app SEO agent (SAM) and onboarding chat use the OpenRouter key. OpenAI/Anthropic keys are stored for future direct provider use."
      >
        <SecretField
          label="OpenRouter API Key"
          value={form.openrouterApiKey}
          onChange={(value) => setAi({ openrouterApiKey: value })}
          placeholder={
            configured.openrouter ? "Saved - enter to change" : "sk-or-..."
          }
          revealed={Boolean(revealed.openrouter)}
          onToggleReveal={() => toggleReveal("openrouter")}
        />
        <SecretField
          label="OpenAI API Key"
          value={form.openaiApiKey}
          onChange={(value) => setAi({ openaiApiKey: value })}
          placeholder={configured.openai ? "Saved - enter to change" : "sk-..."}
          revealed={Boolean(revealed.openai)}
          onToggleReveal={() => toggleReveal("openai")}
        />
        <SecretField
          label="Anthropic API Key"
          value={form.anthropicApiKey}
          onChange={(value) => setAi({ anthropicApiKey: value })}
          placeholder={
            configured.anthropic ? "Saved - enter to change" : "sk-ant-..."
          }
          revealed={Boolean(revealed.anthropic)}
          onToggleReveal={() => toggleReveal("anthropic")}
        />

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Default Model</span>
          <select
            className="select select-bordered w-full"
            value={
              modelPresets.some((m) => m.value === form.defaultModel)
                ? form.defaultModel
                : ""
            }
            onChange={(event) =>
              setAi({ defaultModel: event.currentTarget.value })
            }
          >
            <option value="" disabled>
              Select a model…
            </option>
            {modelPresets.map((model) => (
              <option key={model.value} value={model.value}>
                {model.label}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-5 sm:grid-cols-2">
          <SliderField
            label="Temperature"
            min={0}
            max={2}
            step={0.05}
            value={form.temperature}
            displayValue={form.temperature.toFixed(2)}
            onChange={(value) => setAi({ temperature: value })}
          />
          <SliderField
            label="Max Tokens"
            min={64}
            max={128_000}
            step={64}
            value={form.maxTokens}
            displayValue={String(form.maxTokens)}
            onChange={(value) => setAi({ maxTokens: value })}
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={isTesting}
            onClick={() => void handleTest()}
          >
            {isTesting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Test AI Prompt
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={isSaving}
            onClick={onSave}
          >
            Save AI Settings
          </button>
        </div>

        {testResult ? <TestResultBanner result={testResult} /> : null}
      </SectionCard>
    </div>
  );
}
