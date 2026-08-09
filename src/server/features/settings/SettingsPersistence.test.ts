import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_SETTINGS_PAYLOAD } from "@/server/features/settings/appSettingsSchema";

const { getRowMock, upsertMock, getOptionalEnvValueMock } = vi.hoisted(() => ({
  getRowMock: vi.fn(),
  upsertMock: vi.fn(),
  getOptionalEnvValueMock: vi.fn(),
}));

vi.mock("@/server/features/settings/SettingsRepository", () => ({
  getAppSettingsRow: getRowMock,
  upsertAppSettings: upsertMock,
}));

vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: getOptionalEnvValueMock,
}));

import {
  loadAppSettingsSnapshot,
  saveAppSettingsPayload,
} from "@/server/features/settings/SettingsService";

describe("settings persistence safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOptionalEnvValueMock.mockResolvedValue(undefined);
  });

  it("reads versioned plaintext rows without exposing secrets", async () => {
    getRowMock.mockResolvedValue({
      value: `plain:v1:${JSON.stringify(DEFAULT_APP_SETTINGS_PAYLOAD)}`,
      updatedAt: "saved-at",
    });

    const snapshot = await loadAppSettingsSnapshot({ fresh: true });

    expect(snapshot.readable).toBe(true);
    expect(snapshot.updatedAt).toBe("saved-at");
    expect(snapshot.payload.dataforseo.password).toBe("");
  });

  it("refuses to overwrite an unreadable encrypted row", async () => {
    getRowMock.mockResolvedValue({
      value: "enc:v1:unreadable",
      updatedAt: "saved-at",
    });

    await expect(
      saveAppSettingsPayload(DEFAULT_APP_SETTINGS_PAYLOAD),
    ).rejects.toThrow("could not be decrypted");
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
