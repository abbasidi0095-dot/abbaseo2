/* eslint-disable max-lines -- settings tab keeps the credential list builder colocated to avoid fake indirection. */
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  SectionCard,
  SecretField,
} from "@/client/features/settings/SettingsUi";
import type { FormDataforseoSettings } from "@/client/features/settings/settingsTypes";
import {
  getDataforseoUsage,
  testDataforseoConnection,
} from "@/serverFunctions/settings";
import { toast } from "sonner";

const MAX_CREDENTIALS = 10;

type TestResult = { ok: boolean; message: string } | undefined;

function createCredentialId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `cred-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function DataforseoTab(props: {
  configured: boolean;
  envConfigured: boolean;
  form: FormDataforseoSettings;
  setDataforseo: (patch: Partial<FormDataforseoSettings>) => void;
  isSaving: boolean;
  refreshToken: number;
  onSave: () => void;
}) {
  const {
    configured,
    envConfigured,
    form,
    setDataforseo,
    isSaving,
    refreshToken,
    onSave,
  } = props;
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>(
    {},
  );

  function addCredential() {
    if (form.credentials.length >= MAX_CREDENTIALS) {
      toast.error(
        `You can save up to ${MAX_CREDENTIALS} DataForSEO credentials.`,
      );
      return;
    }
    const id = createCredentialId();
    setDataforseo({
      credentials: [...form.credentials, { id, login: "", password: "" }],
    });
  }

  function updateCredential(
    id: string,
    patch: Partial<{ login: string; password: string }>,
  ) {
    setDataforseo({
      credentials: form.credentials.map((credential) =>
        credential.id === id ? { ...credential, ...patch } : credential,
      ),
    });
  }

  function removeCredential(id: string) {
    setDataforseo({
      credentials: form.credentials.filter(
        (credential) => credential.id !== id,
      ),
    });
  }

  function moveCredential(id: string, direction: -1 | 1) {
    const index = form.credentials.findIndex(
      (credential) => credential.id === id,
    );
    const target = index + direction;
    if (index < 0 || target < 0 || target >= form.credentials.length) return;
    const next = [...form.credentials];
    [next[index], next[target]] = [next[target], next[index]];
    setDataforseo({ credentials: next });
  }

  async function handleTest(id: string) {
    const credential = form.credentials.find((entry) => entry.id === id);
    if (!credential || !credential.login || !credential.password) {
      toast.error("Enter both a login and password to test.");
      return;
    }
    setTestingId(id);
    setTestResults((results) => ({ ...results, [id]: undefined }));
    try {
      const result = await testDataforseoConnection({
        data: { login: credential.login, password: credential.password },
      });
      setTestResults((results) => ({
        ...results,
        [id]: result.ok
          ? {
              ok: true,
              message:
                result.balance != null
                  ? `Connection successful. Account balance: $${result.balance.toFixed(2)}`
                  : "Connection successful.",
            }
          : { ok: false, message: result.message },
      }));
    } catch {
      setTestResults((results) => ({
        ...results,
        [id]: { ok: false, message: "Could not run the connection test." },
      }));
    } finally {
      setTestingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <SectionCard
        title="DataForSEO API Credentials"
        description="The app runs keyword, SERP, backlink, and audit queries through your DataForSEO accounts. Each request uses the account with the most remaining topup; when an account hits zero the next is used automatically."
      >
        <div className="space-y-3">
          {form.credentials.map((credential, index) => (
            <div
              key={credential.id}
              className="space-y-2 rounded-box border border-base-300 bg-base-100 p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-base-content/50">
                  {index === 0 ? "Primary account" : `Fallback ${index + 1}`}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="btn btn-ghost btn-square btn-xs"
                    disabled={index === 0}
                    onClick={() => moveCredential(credential.id, -1)}
                    aria-label="Move up"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-square btn-xs"
                    disabled={index === form.credentials.length - 1}
                    onClick={() => moveCredential(credential.id, 1)}
                    aria-label="Move down"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-square btn-xs text-error"
                    onClick={() => removeCredential(credential.id)}
                    aria-label="Remove credential"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium">
                  DataForSEO Login / Username
                </span>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={credential.login}
                  onChange={(event) =>
                    updateCredential(credential.id, {
                      login: event.currentTarget.value,
                    })
                  }
                  placeholder={
                    credential.login || credential.password
                      ? "Saved - edit to change"
                      : "DataForSEO login"
                  }
                  autoComplete="username"
                  spellCheck={false}
                />
              </label>
              <SecretField
                label="DataForSEO Password / API Key"
                value={credential.password}
                onChange={(value) =>
                  updateCredential(credential.id, { password: value })
                }
                placeholder={
                  credential.login || credential.password
                    ? "Saved - enter to change"
                    : "DataForSEO password"
                }
                revealed={revealed[credential.id] ?? false}
                onToggleReveal={() =>
                  setRevealed((current) => ({
                    ...current,
                    [credential.id]: !(current[credential.id] ?? false),
                  }))
                }
              />

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={testingId !== null}
                  onClick={() => void handleTest(credential.id)}
                >
                  {testingId === credential.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  Test Connection
                </button>
              </div>

              {testResults[credential.id] ? (
                <TestResultBanner result={testResults[credential.id]!} />
              ) : null}
            </div>
          ))}
        </div>

        {envConfigured ? (
          <div className="flex items-center gap-2 rounded-box border border-base-300 bg-base-100 px-3 py-2 text-sm text-base-content/60">
            <span className="size-2 rounded-full bg-base-content/30" />
            <span>
              Environment variable key is configured and will be used as the
              last fallback account.
            </span>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={form.credentials.length >= MAX_CREDENTIALS}
            onClick={addCredential}
          >
            <Plus className="size-4" />
            Add Credential ({form.credentials.length}/{MAX_CREDENTIALS})
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={isSaving}
            onClick={onSave}
          >
            Save Credentials
          </button>
        </div>
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

type UsageRow = {
  id: string;
  login: string;
  fromEnv: boolean;
  invalid: boolean;
  balance: number | null;
  total: number | null;
  daySpend: number | null;
  minuteSpend: number | null;
};

type Usage = {
  credentials: UsageRow[];
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
      description="Live account numbers from DataForSEO's free usage endpoint, one row per credential."
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
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr className="text-xs text-base-content/50">
                  <th>Account</th>
                  <th>Source</th>
                  <th>Balance</th>
                  <th>Deposited (lifetime)</th>
                  <th>Spend (24h)</th>
                </tr>
              </thead>
              <tbody>
                {usage.credentials.map((credential) => (
                  <tr key={credential.id}>
                    <td className="font-medium">{credential.login || "—"}</td>
                    <td className="text-xs text-base-content/50">
                      {credential.invalid ? (
                        <span className="text-error">invalid key</span>
                      ) : credential.fromEnv ? (
                        "environment"
                      ) : (
                        "settings"
                      )}
                    </td>
                    <td
                      className={`font-semibold tabular-nums ${
                        !credential.invalid &&
                        credential.balance !== null &&
                        credential.balance <= 0
                          ? "text-error"
                          : "text-primary"
                      }`}
                    >
                      {credential.invalid || credential.balance === null
                        ? "—"
                        : `$${credential.balance.toFixed(2)}`}
                    </td>
                    <td className="tabular-nums">
                      {credential.total === null
                        ? "—"
                        : `$${credential.total.toFixed(2)}`}
                    </td>
                    <td className="tabular-nums">
                      {credential.daySpend === null
                        ? "—"
                        : `$${credential.daySpend.toFixed(2)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-base-content/60">
            Queries used:{" "}
            <span className="font-semibold text-base-content">
              {usage.queriesUsed.toLocaleString()}
            </span>
          </p>
        </div>
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