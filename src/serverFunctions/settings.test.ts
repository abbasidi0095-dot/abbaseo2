import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  env: {},
  waitUntil: vi.fn(),
}));
import {
  parseAiTestResponse,
  parseDataforseoTestResponse,
} from "@/serverFunctions/settings";
import { appSettingsPayloadSchema } from "@/server/features/settings/appSettingsSchema";

const baseSections = {
  ai: {
    openrouterApiKey: "",
    openaiApiKey: "",
    anthropicApiKey: "",
    defaultModel: "",
    temperature: 1,
    maxTokens: 128_000,
  },
  branding: { appTitle: "AbbaSeo", defaultRegion: "US", currency: "USD" },
};

describe("settings provider test response parsing", () => {
  it("accepts a successful DataForSEO account envelope", () => {
    expect(
      parseDataforseoTestResponse({
        status_code: 20000,
        tasks: [
          {
            status_code: 20000,
            result: [{ money: { balance: 12.5 } }],
          },
        ],
      }),
    ).toEqual({ balance: 12.5 });
  });

  it("rejects malformed DataForSEO success bodies", () => {
    expect(parseDataforseoTestResponse({})).toBeNull();
    expect(
      parseDataforseoTestResponse({
        status_code: 20000,
        tasks: [{ status_code: 40000 }],
      }),
    ).toBeNull();
  });

  it("requires non-empty assistant content from OpenRouter", () => {
    expect(
      parseAiTestResponse({
        choices: [{ message: { content: "ok" } }],
      }),
    ).toBe("ok");
    expect(parseAiTestResponse({ choices: [{}] })).toBeNull();
    expect(parseAiTestResponse({})).toBeNull();
  });
});

describe("save input normalization (legacy + multi-credential)", () => {
  it("parses the new credentials shape into the payload schema", () => {
    const payload = appSettingsPayloadSchema.parse({
      dataforseo: {
        credentials: [{ id: "cred-1", login: "a@b.com", password: "pw" }],
      },
      ...baseSections,
    });
    expect(payload.dataforseo.credentials).toHaveLength(1);
  });

  it("parses a legacy save input into the credentials shape", () => {
    const payload = appSettingsPayloadSchema.parse({
      dataforseo: { login: "old", password: "secret" },
      ...baseSections,
    });
    expect(payload.dataforseo.credentials).toEqual([
      { id: "legacy-1", login: "old", password: "secret" },
    ]);
  });
});
