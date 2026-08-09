import { describe, expect, it } from "vitest";
import {
  appSettingsPayloadSchema,
  publicAppSettingsSchema,
} from "@/server/features/settings/appSettingsSchema";

const payload = {
  dataforseo: { login: "login", password: "secret" },
  ai: {
    openrouterApiKey: "or-key",
    openaiApiKey: "oa-key",
    anthropicApiKey: "ant-key",
    defaultModel: "openai/gpt-4o",
    temperature: 0.7,
    maxTokens: 4096,
  },
  branding: { appTitle: "AbbaSeo", defaultRegion: "US", currency: "USD" },
};

describe("app settings schemas", () => {
  it("accepts the complete deployment payload", () => {
    expect(appSettingsPayloadSchema.parse(payload)).toEqual(payload);
  });

  it("rejects an out-of-range temperature", () => {
    expect(() =>
      appSettingsPayloadSchema.parse({
        ...payload,
        ai: { ...payload.ai, temperature: 2.1 },
      }),
    ).toThrow();
  });

  it("does not allow secret fields in the public response", () => {
    const result = publicAppSettingsSchema.parse({
      updatedAt: null,
      dataforseo: { configured: true, login: "login" },
      ai: {
        openrouterConfigured: true,
        openaiConfigured: false,
        anthropicConfigured: false,
        defaultModel: "openai/gpt-4o",
        temperature: 0.7,
        maxTokens: 4096,
      },
      branding: payload.branding,
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("or-key");
  });
});
