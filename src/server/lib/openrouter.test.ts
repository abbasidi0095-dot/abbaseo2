import { beforeEach, describe, expect, it, vi } from "vitest";

const { createOpenRouterMock, dynamicValueMock } = vi.hoisted(() => ({
  createOpenRouterMock: vi.fn(),
  dynamicValueMock: vi.fn(),
}));

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: createOpenRouterMock,
}));

vi.mock("@/server/features/settings/SettingsService", () => ({
  getDynamicRequiredEnvValue: dynamicValueMock,
}));

import { getChatAgentModel } from "@/server/lib/openrouter";

describe("getChatAgentModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dynamicValueMock.mockImplementation(async (name: string) =>
      name === "OPENROUTER_API_KEY" ? "stored-key" : "stored-model",
    );
    createOpenRouterMock.mockReturnValue((model: string, options: unknown) => ({
      model,
      options,
    }));
  });

  it("builds the agent with the dynamically resolved key and model", async () => {
    await expect(getChatAgentModel()).resolves.toMatchObject({
      model: "stored-model",
    });
    expect(createOpenRouterMock).toHaveBeenCalledWith({ apiKey: "stored-key" });
  });
});
