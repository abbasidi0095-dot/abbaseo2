import { describe, expect, it } from "vitest";
import {
  appSettingsPayloadSchema,
  DEFAULT_APP_SETTINGS_PAYLOAD,
  dataforseoSettingsSchema,
} from "@/server/features/settings/appSettingsSchema";

describe("dataforseoSettingsSchema", () => {
  it("accepts the new credentials-array shape", () => {
    const parsed = dataforseoSettingsSchema.parse({
      credentials: [
        { id: "cred-1", login: "a@b.com", password: "secret" },
        { id: "cred-2", login: "c@d.com", password: "pw2" },
      ],
    });
    expect(parsed.credentials).toHaveLength(2);
    expect(parsed.credentials[0].id).toBe("cred-1");
  });

  it("migrates the legacy login/password shape on read", () => {
    const parsed = dataforseoSettingsSchema.parse({
      login: "old-login",
      password: "old-password",
    });
    expect(parsed.credentials).toEqual([
      { id: "legacy-1", login: "old-login", password: "old-password" },
    ]);
  });

  it("turns an empty legacy payload into an empty credential list", () => {
    expect(
      dataforseoSettingsSchema.parse({ login: "", password: "" }).credentials,
    ).toEqual([]);
  });

  it("rejects more than 10 credentials", () => {
    const many = Array.from({ length: 11 }, (_, index) => ({
      id: `cred-${index}`,
      login: "login",
      password: "pw",
    }));
    expect(
      dataforseoSettingsSchema.safeParse({ credentials: many }).success,
    ).toBe(false);
  });
});

describe("appSettingsPayloadSchema", () => {
  it("parses a legacy full payload into the credentials shape", () => {
    const parsed = appSettingsPayloadSchema.parse({
      dataforseo: { login: "l", password: "p" },
      ai: {
        openrouterApiKey: "",
        openaiApiKey: "",
        anthropicApiKey: "",
        defaultModel: "",
        temperature: 1,
        maxTokens: 128_000,
      },
      branding: {
        appTitle: "AbbaSeo",
        defaultRegion: "US",
        currency: "USD",
      },
    });
    expect(parsed.dataforseo.credentials[0]).toEqual({
      id: "legacy-1",
      login: "l",
      password: "p",
    });
  });

  it("keeps the default payload empty yet parseable", () => {
    const parsed = appSettingsPayloadSchema.parse(DEFAULT_APP_SETTINGS_PAYLOAD);
    expect(parsed.dataforseo.credentials).toEqual([]);
  });
});
