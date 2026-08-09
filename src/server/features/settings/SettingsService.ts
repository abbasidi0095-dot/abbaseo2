import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import {
  appSettingsPayloadSchema,
  DEFAULT_APP_SETTINGS_PAYLOAD,
  type AppSettingsPayload,
} from "@/server/features/settings/appSettingsSchema";
import { AppError } from "@/server/lib/errors";

// ---------------------------------------------------------------------------
// Deployment-wide settings store.
//
// The Settings screen writes one payload (DataForSEO credentials, AI keys,
// branding/preferences) that overrides the equivalent env vars at runtime —
// no restart needed. Reads hit the store first, then fall back to env (the
// pre-Settings model), so a fresh deployment with nothing saved behaves
// exactly as before.
//
// Secrets are encrypted at rest with the same symmetric helper as the GSC
// OAuth tokens (BETTER_AUTH_SECRET). When no BETTER_AUTH_SECRET is configured
// (trusted local/self-hosted modes) the payload is stored as plaintext, the
// same trade the GSC path makes via its encryptOAuthTokens gate.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 10_000;
const ENCRYPTED_PAYLOAD_PREFIX = "enc:v1:";
const PLAINTEXT_PAYLOAD_PREFIX = "plain:v1:";
const DEFAULT_AI_GENERATION_SETTINGS = {
  temperature: 1,
  maxOutputTokens: 128_000,
} as const;

// Module-level cache shared by server-function calls (worker isolates re-use
// module state between requests). Cleared on save so changes take effect
// immediately.
type SettingsSnapshot = {
  payload: AppSettingsPayload;
  updatedAt: string | null;
  readable: boolean;
};

export type SavedAppSettingsPayload = {
  payload: AppSettingsPayload;
  updatedAt: string;
};

let cache: (SettingsSnapshot & { fetchedAt: number }) | null = null;

function emptyPayload(): AppSettingsPayload {
  return structuredClone(DEFAULT_APP_SETTINGS_PAYLOAD);
}

export function mergeAppSettingsSecrets(
  current: AppSettingsPayload,
  input: AppSettingsPayload,
): AppSettingsPayload {
  return {
    ...input,
    dataforseo: {
      ...input.dataforseo,
      login: input.dataforseo.login || current.dataforseo.login,
      password: input.dataforseo.password || current.dataforseo.password,
    },
    ai: {
      ...input.ai,
      openrouterApiKey:
        input.ai.openrouterApiKey || current.ai.openrouterApiKey,
      openaiApiKey: input.ai.openaiApiKey || current.ai.openaiApiKey,
      anthropicApiKey: input.ai.anthropicApiKey || current.ai.anthropicApiKey,
    },
  };
}

async function shouldEncrypt(): Promise<boolean> {
  // Only encrypt when a stable key exists; better-auth otherwise derives a
  // random secret per boot that would make stored payloads undecryptable
  // after a restart.
  const { getOptionalEnvValue } = await import("@/server/lib/runtime-env");
  return getOptionalEnvValue("BETTER_AUTH_SECRET").then(Boolean);
}

async function encryptPayload(payload: AppSettingsPayload): Promise<string> {
  const serialized = JSON.stringify(payload);
  if (!(await shouldEncrypt())) {
    return `${PLAINTEXT_PAYLOAD_PREFIX}${serialized}`;
  }
  const { getAuth } = await import("@/lib/auth");
  const ctx = await getAuth().$context;
  const encrypted = await symmetricEncrypt({
    key: ctx.secretConfig,
    data: serialized,
  });
  return `${ENCRYPTED_PAYLOAD_PREFIX}${encrypted}`;
}

async function decryptPayload(value: string): Promise<SettingsSnapshot> {
  try {
    const isEncrypted = await shouldEncrypt();
    let raw: string;
    if (value.startsWith(ENCRYPTED_PAYLOAD_PREFIX)) {
      if (!isEncrypted)
        return { payload: emptyPayload(), readable: false, updatedAt: null };
      const { getAuth } = await import("@/lib/auth");
      const ctx = await getAuth().$context;
      raw = await symmetricDecrypt({
        key: ctx.secretConfig,
        data: value.slice(ENCRYPTED_PAYLOAD_PREFIX.length),
      });
    } else if (value.startsWith(PLAINTEXT_PAYLOAD_PREFIX)) {
      raw = value.slice(PLAINTEXT_PAYLOAD_PREFIX.length);
    } else if (value.trimStart().startsWith("{")) {
      // Legacy plaintext rows are still readable so deployments can migrate
      // to the versioned envelope on their next successful save.
      raw = value;
    } else if (isEncrypted) {
      // Legacy encrypted rows had no envelope marker.
      const { getAuth } = await import("@/lib/auth");
      const ctx = await getAuth().$context;
      raw = await symmetricDecrypt({ key: ctx.secretConfig, data: value });
    } else {
      return { payload: emptyPayload(), readable: false, updatedAt: null };
    }
    return {
      payload: appSettingsPayloadSchema.parse(JSON.parse(raw)),
      updatedAt: null,
      readable: true,
    };
  } catch {
    // Do not silently turn an unreadable encrypted row into an empty payload;
    // a later save must refuse rather than destroy the only recoverable copy.
    return { payload: emptyPayload(), updatedAt: null, readable: false };
  }
}

/**
 * Loads the stored settings payload with a short TTL. Explicitly cleared by
 * {@link saveAppSettingsPayload} so an immediate next read is fresh.
 */
async function readAppSettingsSnapshot(): Promise<SettingsSnapshot> {
  const { getAppSettingsRow } =
    await import("@/server/features/settings/SettingsRepository");
  const row = await getAppSettingsRow();
  if (!row) {
    return { payload: emptyPayload(), updatedAt: null, readable: true };
  }
  const decrypted = await decryptPayload(row.value);
  return { ...decrypted, updatedAt: row.updatedAt };
}

export async function loadAppSettingsSnapshot(options?: {
  fresh?: boolean;
}): Promise<SettingsSnapshot> {
  if (!options?.fresh && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }
  const snapshot = await readAppSettingsSnapshot();
  cache = { ...snapshot, fetchedAt: Date.now() };
  return snapshot;
}

export async function loadAppSettings(): Promise<AppSettingsPayload> {
  return (await loadAppSettingsSnapshot()).payload;
}

export async function saveAppSettingsPayload(
  payload: AppSettingsPayload,
  expectedUpdatedAt?: string | null,
): Promise<SavedAppSettingsPayload> {
  const current = await loadAppSettingsSnapshot({ fresh: true });
  if (!current.readable) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Saved application settings could not be decrypted. Refusing to overwrite them.",
    );
  }
  const parsed = appSettingsPayloadSchema.parse(payload);
  const value = await encryptPayload(parsed);
  const { upsertAppSettings } =
    await import("@/server/features/settings/SettingsRepository");
  const savedUpdatedAt = await upsertAppSettings(
    value,
    expectedUpdatedAt === undefined ? current.updatedAt : expectedUpdatedAt,
  );
  if (!savedUpdatedAt) {
    invalidateAppSettingsCache();
    throw new AppError(
      "CONFLICT",
      "Settings changed in another session. Reload the page and try again.",
    );
  }

  const normalized = { ...parsed };
  // Prune unset secrets to empty strings so the UI never round-trips nulls.
  const dataforseo = { ...parsed.dataforseo };
  const ai = { ...parsed.ai };
  for (const key of ["login", "password"] as const) {
    dataforseo[key] = dataforseo[key] ?? "";
  }
  for (const key of [
    "openrouterApiKey",
    "openaiApiKey",
    "anthropicApiKey",
  ] as const) {
    ai[key] = ai[key] ?? "";
  }
  normalized.dataforseo = dataforseo;
  normalized.ai = ai;

  cache = {
    fetchedAt: Date.now(),
    payload: normalized,
    updatedAt: savedUpdatedAt,
    readable: true,
  };
  return { payload: normalized, updatedAt: savedUpdatedAt };
}

/** Force a fresh read (e.g. after a connection test tapped the live store). */
export function invalidateAppSettingsCache(): void {
  cache = null;
}

// ---------------------------------------------------------------------------
// Dynamic env override. These names shadow the equivalent env vars for every
// client that resolves credentials through runtime-env.
// ---------------------------------------------------------------------------

function encodeDataforseoApiKey(login: string, password: string): string {
  return btoa(`${login}:${password}`);
}

export async function getDynamicSecretValue(
  name:
    | "DATAFORSEO_API_KEY"
    | "OPENROUTER_API_KEY"
    | "OPENAI_API_KEY"
    | "ANTHROPIC_API_KEY"
    | "OPENROUTER_MODEL",
): Promise<string | undefined> {
  const payload = await loadAppSettings();
  switch (name) {
    case "DATAFORSEO_API_KEY":
      if (payload.dataforseo?.login && payload.dataforseo?.password) {
        return encodeDataforseoApiKey(
          payload.dataforseo.login,
          payload.dataforseo.password,
        );
      }
      return undefined;
    case "OPENROUTER_API_KEY":
      return payload.ai?.openrouterApiKey || undefined;
    case "OPENAI_API_KEY":
      return payload.ai?.openaiApiKey || undefined;
    case "ANTHROPIC_API_KEY":
      return payload.ai?.anthropicApiKey || undefined;
    case "OPENROUTER_MODEL":
      return payload.ai?.defaultModel || undefined;
  }
}

/**
 * env -> settings store fallback for the DataForSEO/OpenRouter clients.
 * Keeps the old env-var behavior as the default and the Settings screen as
 * the override.
 */
export async function getDynamicRequiredEnvValue(
  name:
    | "DATAFORSEO_API_KEY"
    | "OPENROUTER_API_KEY"
    | "OPENAI_API_KEY"
    | "ANTHROPIC_API_KEY"
    | "OPENROUTER_MODEL",
): Promise<string> {
  let fromSettings: string | undefined;
  try {
    fromSettings = await getDynamicSecretValue(name);
  } catch {
    // A temporarily unavailable settings store must not hide a valid env key.
  }
  if (fromSettings) return fromSettings;
  const { getRequiredEnvValue } = await import("@/server/lib/runtime-env");
  return getRequiredEnvValue(name);
}

export async function isDynamicSecretConfigured(
  name: Parameters<typeof getDynamicRequiredEnvValue>[0],
): Promise<boolean> {
  try {
    await getDynamicRequiredEnvValue(name);
    return true;
  } catch {
    return false;
  }
}

export async function getDynamicAiGenerationSettings(): Promise<{
  temperature: number;
  maxOutputTokens: number;
}> {
  try {
    const payload = await loadAppSettings();
    return {
      temperature: payload.ai.temperature,
      maxOutputTokens: payload.ai.maxTokens,
    };
  } catch {
    return DEFAULT_AI_GENERATION_SETTINGS;
  }
}
