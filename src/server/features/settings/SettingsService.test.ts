import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_SETTINGS_PAYLOAD } from "@/server/features/settings/appSettingsSchema";

const { getRowMock, getOptionalEnvValueMock, getRequiredEnvValueMock } =
  vi.hoisted(() => ({
    getRowMock: vi.fn(),
    getOptionalEnvValueMock: vi.fn(),
    getRequiredEnvValueMock: vi.fn(),
  }));

vi.mock("@/server/features/settings/SettingsRepository", () => ({
  getAppSettingsRow: getRowMock,
}));

vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: getOptionalEnvValueMock,
  getRequiredEnvValue: getRequiredEnvValueMock,
}));

import {
  generateDefaultPayload,
  getDynamicAiGenerationSettings,
  getDynamicRequiredEnvValue,
  invalidateAppSettingsCache,
  isDynamicSecretConfigured,
  mergeAppSettingsSecrets,
} from "@/server/features/settings/SettingsService";

beforeEach(() => {
  vi.clearAllMocks();
  getRowMock.mockResolvedValue(null);
  getOptionalEnvValueMock.mockImplementation(async (name: string) => {
    return process.env[name] || undefined;
  });
  getRequiredEnvValueMock.mockImplementation(async (name: string) => {
    const value = process.env[name];
    if (!value)
      throw new Error(`Missing required environment variable: ${name}`);
    return value;
  });
  invalidateAppSettingsCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function makePayload(
  credentials: Array<{ id: string; login: string; password: string }>,
) {
  const payload = generateDefaultPayload();
  payload.dataforseo.credentials = credentials;
  return payload;
}

describe("mergeAppSettingsSecrets", () => {
  it("preserves configured secrets when another tab saves blank secret fields", () => {
    const current = {
      dataforseo: {
        credentials: [
          { id: "cred-1", login: "saved-login", password: "saved-password" },
        ],
      },
      ai: {
        openrouterApiKey: "saved-or-key",
        openaiApiKey: "saved-oa-key",
        anthropicApiKey: "saved-ant-key",
        defaultModel: "openai/gpt-4o",
        temperature: 1,
        maxTokens: 4096,
      },
      branding: { appTitle: "AbbaSeo", defaultRegion: "US", currency: "USD" },
    };
    const input = {
      ...current,
      dataforseo: {
        credentials: [
          { id: "cred-1", login: "", password: "" },
        ],
      },
      ai: {
        ...current.ai,
        openrouterApiKey: "",
        openaiApiKey: "",
        anthropicApiKey: "",
      },
      branding: { appTitle: "New title", defaultRegion: "UK", currency: "GBP" },
    };

    expect(mergeAppSettingsSecrets(current, input)).toEqual({
      ...current,
      branding: input.branding,
    });
  });

  it("detects a configured provider value through the dynamic resolver", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "env-key");

    await expect(isDynamicSecretConfigured("OPENROUTER_API_KEY")).resolves.toBe(
      true,
    );
  });

  it("prefers a stored provider value over its environment fallback", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "env-key");
    getRowMock.mockResolvedValue({
      value: `plain:v1:${JSON.stringify({
        ...DEFAULT_APP_SETTINGS_PAYLOAD,
        ai: {
          ...DEFAULT_APP_SETTINGS_PAYLOAD.ai,
          openrouterApiKey: "stored-key",
        },
      })}`,
      updatedAt: "saved-at",
    });

    await expect(
      getDynamicRequiredEnvValue("OPENROUTER_API_KEY"),
    ).resolves.toBe("stored-key");
  });

  it("falls back to the environment when the settings store is unavailable", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "env-key");
    getRowMock.mockRejectedValue(new Error("database unavailable"));

    await expect(
      getDynamicRequiredEnvValue("OPENROUTER_API_KEY"),
    ).resolves.toBe("env-key");
  });

  it("provides safe generation defaults when settings are unavailable", async () => {
    await expect(getDynamicAiGenerationSettings()).resolves.toEqual({
      temperature: 1,
      maxOutputTokens: 128_000,
    });
  });
});

describe("mergeAppSettingsSecrets (dataforseo credentials)", () => {
  it("keeps the existing password when the incoming row leaves it blank", () => {
    const current = makePayload([
      { id: "cred-1", login: "a@b.com", password: "super-secret" },
    ]);
    const input = makePayload([
      { id: "cred-1", login: "a@b.com", password: "" },
    ]);

    const merged = mergeAppSettingsSecrets(current, input);

    expect(merged.dataforseo.credentials).toEqual([
      { id: "cred-1", login: "a@b.com", password: "super-secret" },
    ]);
  });

  it("replaces the password when the incoming row sets one", () => {
    const current = makePayload([
      { id: "cred-1", login: "a@b.com", password: "old" },
    ]);
    const input = makePayload([
      { id: "cred-1", login: "a@b.com", password: "new" },
    ]);

    const merged = mergeAppSettingsSecrets(current, input);

    expect(merged.dataforseo.credentials[0].password).toBe("new");
  });

  it("adds new credentials and drops rows with neither login nor password", () => {
    const current = makePayload([]);
    const input = makePayload([
      { id: "cred-1", login: "a@b.com", password: "pw" },
      { id: "cred-2", login: "", password: "" },
      { id: "cred-3", login: "c@d.com", password: "" },
    ]);

    const merged = mergeAppSettingsSecrets(current, input);

    expect(merged.dataforseo.credentials).toEqual([
      { id: "cred-1", login: "a@b.com", password: "pw" },
      { id: "cred-3", login: "c@d.com", password: "" },
    ]);
  });
});