import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AppError } from "@/server/lib/errors";
import {
  requireAuthenticatedContext,
  requireSettingsAdminContext,
} from "@/serverFunctions/middleware";
import {
  DATAFORSEO_USER_DATA_URL,
  parseUserDataAccountPayload,
} from "@/server/lib/dataforseo/user-data";
import {
  dataforseoCredentialSelector,
  loadConfiguredDataforseoCredentials,
} from "@/server/lib/dataforseo/credential-selector";
import { probeUserDataAccount } from "@/server/lib/dataforseo/user-data";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import {
  appSettingsPayloadSchema,
  publicAppSettingsSchema,
  type PublicAppSettings,
} from "@/server/features/settings/appSettingsSchema";
import {
  isDynamicSecretConfigured,
  loadAppSettings,
  loadAppSettingsSnapshot,
  mergeAppSettingsSecrets,
  saveAppSettingsPayload,
} from "@/server/features/settings/SettingsService";

// ---------------------------------------------------------------------------
// Settings screen server functions. All reads return a redacted view (secrets
// become booleans); the save endpoint is the only writer, and the test
// endpoints validate form values WITHOUT persisting them.
// ---------------------------------------------------------------------------

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const AI_TEST_PROMPT = "Reply with exactly: ok";

export function parseDataforseoTestResponse(
  value: unknown,
): { balance: number | null } | null {
  const account = parseUserDataAccountPayload(value);
  return account ? { balance: account.balance } : null;
}

const aiTestResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string() }).optional(),
      }),
    )
    .optional(),
});

export function parseAiTestResponse(value: unknown): string | null {
  const parsed = aiTestResponseSchema.safeParse(value);
  const content = parsed.success
    ? parsed.data.choices?.[0]?.message?.content?.trim()
    : undefined;
  return content || null;
}

async function redact(
  payload: Awaited<ReturnType<typeof loadAppSettings>>,
  updatedAt: string | null,
): Promise<PublicAppSettings> {
  const [
    dataforseoConfigured,
    openrouterConfigured,
    openaiConfigured,
    anthropicConfigured,
    envConfigured,
  ] = await Promise.all([
    isDynamicSecretConfigured("DATAFORSEO_API_KEY"),
    isDynamicSecretConfigured("OPENROUTER_API_KEY"),
    isDynamicSecretConfigured("OPENAI_API_KEY"),
    isDynamicSecretConfigured("ANTHROPIC_API_KEY"),
    getOptionalEnvValue("DATAFORSEO_API_KEY").then(Boolean),
  ]);

  return publicAppSettingsSchema.parse({
    updatedAt,
    dataforseo: {
      configured: dataforseoConfigured,
      credentials: payload.dataforseo.credentials.map((credential) => ({
        id: credential.id,
        login: credential.login,
      })),
      envConfigured,
    },
    ai: {
      openrouterConfigured,
      openaiConfigured,
      anthropicConfigured,
      defaultModel: payload.ai?.defaultModel ?? "",
      temperature: payload.ai?.temperature ?? 1,
      maxTokens: payload.ai?.maxTokens ?? 128_000,
    },
    branding: payload.branding,
  });
}

export const getAppSettings = createServerFn({ method: "GET" })
  .middleware(requireSettingsAdminContext)
  .handler(async () => {
    const snapshot = await loadAppSettingsSnapshot({ fresh: true });
    if (!snapshot.readable) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Saved application settings could not be decrypted.",
      );
    }
    return redact(snapshot.payload, snapshot.updatedAt);
  });

export const getAppBranding = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async () => (await loadAppSettings()).branding);

const saveAppSettingsInputSchema = z.object({
  expectedUpdatedAt: z.string().nullable().optional(),
  dataforseo: z.union([
    z.object({
      credentials: z
        .array(
          z.object({
            id: z.string().min(1).max(64),
            login: z.string().max(255).optional().default(""),
            password: z.string().max(1024).optional().default(""),
          }),
        )
        .max(10),
    }),
    // Legacy single-pair payloads still save.
    z.object({
      login: z.string().max(255).optional().default(""),
      password: z.string().max(1024).optional().default(""),
    }),
  ]),
  ai: z.object({
    openrouterApiKey: z.string().max(1024).optional().default(""),
    openaiApiKey: z.string().max(1024).optional().default(""),
    anthropicApiKey: z.string().max(1024).optional().default(""),
    defaultModel: z.string().max(255).optional().default(""),
    temperature: z.number().min(0).max(2).optional().default(1),
    maxTokens: z
      .number()
      .int()
      .min(64)
      .max(128_000)
      .optional()
      .default(128_000),
  }),
  branding: z.object({
    appTitle: z.string().min(1).max(100).default("AbbaSeo"),
    defaultRegion: z.string().max(10).default("US"),
    currency: z.string().max(10).default("USD"),
  }),
});

export const saveAppSettings = createServerFn({ method: "POST" })
  .middleware(requireSettingsAdminContext)
  .validator(saveAppSettingsInputSchema)
  .handler(async ({ data: input }) => {
    const current = await loadAppSettingsSnapshot({ fresh: true });
    const payload = mergeAppSettingsSecrets(
      current.payload,
      appSettingsPayloadSchema.parse(input),
    );
    const saved = await saveAppSettingsPayload(
      payload,
      input.expectedUpdatedAt === undefined
        ? current.updatedAt
        : input.expectedUpdatedAt,
    );
    // New credentials must be probed fresh — old balance snapshots are stale.
    dataforseoCredentialSelector.invalidateCache();
    return redact(saved.payload, saved.updatedAt);
  });

// Test DataForSEO credentials WITHOUT saving them: the free /v3/appendix/user_data
// endpoint round-trips the Basic auth header, so a 2xx proves the credentials
// and returns account info to show in the UI. Provider-level failures are a
// normal test result (not an app error), so they're returned as `ok: false`.
const dataforseoTestInputSchema = z.object({
  login: z.string().min(1).max(255),
  password: z.string().min(1).max(1024),
});

export const testDataforseoConnection = createServerFn({ method: "POST" })
  .middleware(requireSettingsAdminContext)
  .validator(dataforseoTestInputSchema)
  .handler(async ({ data: input }) => {
    const token = btoa(`${input.login}:${input.password}`);

    let response: Response;
    try {
      response = await fetch(DATAFORSEO_USER_DATA_URL, {
        headers: { Authorization: `Basic ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return {
        ok: false as const,
        message:
          "Could not reach the DataForSEO API. Check the network and try again.",
      };
    }

    if (!response.ok) {
      const isAuthFailure = response.status === 401 || response.status === 403;
      return {
        ok: false as const,
        message: isAuthFailure
          ? "DataForSEO rejected these credentials. Double-check the login and password."
          : `DataForSEO responded with HTTP ${response.status}. Try again in a moment.`,
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        ok: false as const,
        message: "DataForSEO returned an invalid account response.",
      };
    }
    const parsed = parseDataforseoTestResponse(body);
    if (!parsed) {
      return {
        ok: false as const,
        message: "DataForSEO returned an invalid account response.",
      };
    }
    return {
      ok: true as const,
      balance: parsed.balance,
    };
  });

// Test an AI key + model against OpenRouter WITHOUT saving them. Returns
// status + latency so the UI can prove the prompt round-trips end to end.
const aiTestInputSchema = z.object({
  apiKey: z.string().min(1).max(1024),
  model: z.string().min(1).max(255),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(64).max(128_000),
});

export const testAiConnection = createServerFn({ method: "POST" })
  .middleware(requireSettingsAdminContext)
  .validator(aiTestInputSchema)
  .handler(async ({ data: input }) => {
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(OPENROUTER_CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.apiKey}`,
        },
        body: JSON.stringify({
          model: input.model,
          messages: [{ role: "user", content: AI_TEST_PROMPT }],
          temperature: input.temperature,
          max_tokens: Math.min(input.maxTokens, 64),
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      return {
        ok: false as const,
        message: "Could not reach OpenRouter. Check the network and try again.",
      };
    }

    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      const isAuthFailure = response.status === 401 || response.status === 403;
      return {
        ok: false as const,
        message: isAuthFailure
          ? `OpenRouter rejected this API key (HTTP ${response.status}).`
          : `OpenRouter responded with HTTP ${response.status}. Try again in a moment.`,
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        ok: false as const,
        message: "OpenRouter returned an invalid response.",
      };
    }
    const content = parseAiTestResponse(body);
    if (!content) {
      return {
        ok: false as const,
        message: "OpenRouter returned an invalid response.",
      };
    }
    return {
      ok: true as const,
      latencyMs,
      echoed: content,
    };
  });

// Live per-credential usage & balance, probed from DataForSEO's free
// user_data endpoint for every configured credential (settings list first,
// env var last). Returns account numbers per credential so the UI can show
// which account will serve requests and which are exhausted.
export const getDataforseoUsage = createServerFn({ method: "GET" })
  .middleware(requireSettingsAdminContext)
  .handler(async () => {
    const credentials = await loadConfiguredDataforseoCredentials();
    if (credentials.length === 0) {
      throw new AppError(
        "VALIDATION_ERROR",
        "DataForSEO credentials are not configured. Save them in Settings first.",
      );
    }

    const rows = await Promise.all(
      credentials.map(async (credential) => {
        const { account, invalid } = await probeUserDataAccount(
          credential.encoded,
        );
        return {
          id: credential.id,
          login: account?.login ?? credential.login,
          fromEnv: credential.fromEnv,
          invalid,
          balance: account?.balance ?? null,
          total: account?.total ?? null,
          daySpend: account?.daySpend ?? null,
          minuteSpend: account?.minuteSpend ?? null,
        };
      }),
    );

    const { getAppSettingsQueryCount } =
      await import("@/server/features/settings/SettingsRepository");
    return {
      credentials: rows,
      queriesUsed: await getAppSettingsQueryCount(),
    };
  });

const AI_MODEL_PRESETS: Array<{ label: string; value: string }> = [
  {
    label: "Anthropic Claude 3.5 Sonnet",
    value: "anthropic/claude-3.5-sonnet",
  },
  {
    label: "Anthropic Claude 3.7 Sonnet",
    value: "anthropic/claude-3.7-sonnet",
  },
  { label: "OpenAI GPT-4o", value: "openai/gpt-4o" },
  { label: "OpenAI GPT-4o mini", value: "openai/gpt-4o-mini" },
  { label: "Google Gemini 2.0 Flash", value: "google/gemini-2.0-flash-001" },
  { label: "Google Gemini Flash", value: "google/gemini-flash" },
  { label: "Meta Llama 3.3 70B", value: "meta-llama/llama-3.3-70b-instruct" },
  { label: "MiniMax M3", value: "minimax/minimax-m3" },
];

export const getAiModelPresets = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async () => AI_MODEL_PRESETS);
