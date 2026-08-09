import { Check, CircleAlert, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  SectionCard,
  SecretField,
} from "@/client/features/settings/SettingsUi";
import type { FormSettingsState } from "@/client/features/settings/settingsTypes";
import {
  getDataforseoUsage,
  testDataforseoConnection,
} from "@/serverFunctions/settings";
import { toast } from "sonner";

type TestResult = { ok: boolean; message: string } | undefined;

export function DataforseoTab(props: {
  configured: boolean;
  form: FormSettingsState["dataforseo"];
  setDataforseo: (patch: Partial<FormSettingsState["dataforseo"]>) => void;
  isSaving: boolean;
  refreshToken: number;
  onSave: () => void;
}) {
  const { configured, form, setDataforseo, isSaving, refreshToken, onSave } =
    props;
  const [revealPassword, setRevealPassword] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>(undefined);

  async function handleTest() {
    if (!form.login || !form.password) {
      toast.error("Enter both a login and password to test.");
      return;
    }
    setIsTesting(true);
    setTestResult(undefined);
    try {
      const result = await testDataforseoConnection({
        data: { login: form.login, password: form.password },
      });
      setTestResult(
        result.ok
          ? {
              ok: true,
              message:
                result.balance != null
                  ? `Connection successful. Account balance: $${result.balance.toFixed(2)}`
                  : "Connection successful.",
            }
          : { ok: false, message: result.message },
      );
    } catch {
      setTestResult({
        ok: false,
        message: "Could not run the connection test.",
      });
    } finally {
      setIsTesting(false);
    }
  }

  return (
    <div className="space-y-6">
      <SectionCard
        title="DataForSEO API Credentials"
        description="The app runs keyword, SERP, backlink, and audit queries through your DataForSEO account."
      >
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">
            DataForSEO Login / Username
          </span>
          <input
            type="text"
            className="input input-bordered w-full"
            value={form.login}
            onChange={(event) =>
              setDataforseo({ login: event.currentTarget.value })
            }
            placeholder={
              configured ? "Saved - edit to change" : "DataForSEO login"
            }
            autoComplete="username"
            spellCheck={false}
          />
        </label>
        <SecretField
          label="DataForSEO Password / API Key"
          value={form.password}
          onChange={(value) => setDataforseo({ password: value })}
          placeholder={
            configured ? "Saved - enter to change" : "DataForSEO password"
          }
          revealed={revealPassword}
          onToggleReveal={() => setRevealPassword((v) => !v)}
        />

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
            Test Connection
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={isSaving}
            onClick={onSave}
          >
            Save Credentials
          </button>
        </div>

        {testResult ? <TestResultBanner result={testResult} /> : null}
      </SectionCard>

      <UsageCard configured={configured} refreshToken={refreshToken} />
    </div>
  );
}

export function TestResultBanner({
  result,
}: {
  result: NonNullable<TestResult>;
}) {
  return (
    <div
      role="status"
      className={`flex items-start gap-2 rounded-box border p-3 text-sm ${
        result.ok
          ? "border-success/30 bg-success/10 text-success"
          : "border-error/30 bg-error/10 text-error"
      }`}
    >
      {result.ok ? (
        <Check className="mt-0.5 size-4 shrink-0" />
      ) : (
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
      )}
      {result.message}
    </div>
  );
}

type Usage = {
  login: string;
  balance: number;
  total: number;
  daySpend: number;
  minuteSpend: number;
  queriesUsed: number;
};

function UsageCard({
  configured,
  refreshToken,
}: {
  configured: boolean;
  refreshToken: number;
}) {
  const [usage, setUsage] = useState<Usage | undefined>(undefined);
  const [status, setStatus] = useState<
    "loading" | "loaded" | "error" | "empty"
  >("loading");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      setUsage(await getDataforseoUsage());
      setStatus("loaded");
    } catch {
      setStatus(configured ? "error" : "empty");
    }
  }, [configured]);

  useEffect(() => {
    if (!configured) {
      setStatus("empty");
      return;
    }
    void load();
  }, [configured, load, refreshToken]);

  return (
    <SectionCard
      title="API Usage & Balance"
      description="Live account numbers from DataForSEO's free usage endpoint."
    >
      {status === "loading" ? (
        <div className="flex items-center gap-2 py-4 text-sm text-base-content/50">
          <Loader2 className="size-4 animate-spin" />
          Fetching account usage…
        </div>
      ) : null}

      {status === "empty" ? (
        <p className="py-2 text-sm text-base-content/60">
          Save DataForSEO credentials above to see your live balance and usage.
        </p>
      ) : null}

      {status === "error" ? (
        <p className="flex items-center gap-2 py-2 text-sm text-error">
          <CircleAlert className="size-4" />
          Could not fetch usage. Refresh or re-test your credentials.
        </p>
      ) : null}

      {status === "loaded" && usage ? (
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Account" value={usage.login} />
          <Stat
            label="Balance"
            value={`$${usage.balance.toFixed(2)}`}
            emphasis
          />
          <Stat
            label="Deposited (lifetime)"
            value={`$${usage.total.toFixed(2)}`}
          />
          <Stat label="Spend (24h)" value={`$${usage.daySpend.toFixed(2)}`} />
          <Stat
            label="Queries used"
            value={usage.queriesUsed.toLocaleString()}
          />
        </dl>
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={status === "loading"}
          onClick={() => void load()}
        >
          <RefreshCw
            className={`size-3.5 ${status === "loading" ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>
    </SectionCard>
  );
}

function Stat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-3">
      <dt className="text-xs text-base-content/50">{label}</dt>
      <dd
        className={`mt-1 truncate text-sm font-semibold ${
          emphasis ? "text-primary" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
