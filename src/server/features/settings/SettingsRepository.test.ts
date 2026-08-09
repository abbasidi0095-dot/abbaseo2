import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  insertMock,
  valuesMock,
  conflictMock,
  conflictDoNothingMock,
  sqlMock,
  updateMock,
  setMock,
  whereMock,
  returningMock,
} = vi.hoisted(() => ({
  insertMock: vi.fn(),
  valuesMock: vi.fn(),
  conflictMock: vi.fn(),
  conflictDoNothingMock: vi.fn(),
  sqlMock: vi.fn(() => "increment-expression"),
  updateMock: vi.fn(),
  setMock: vi.fn(),
  whereMock: vi.fn(),
  returningMock: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: { insert: insertMock, update: updateMock },
}));

vi.mock("@/db/schema", () => ({
  appSettings: {
    id: "id",
    queryCount: "queryCount",
    updatedAt: "updatedAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  sql: sqlMock,
}));

import {
  incrementAppSettingsQueryCount,
  upsertAppSettings,
} from "@/server/features/settings/SettingsRepository";

describe("incrementAppSettingsQueryCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    valuesMock.mockReturnValue({
      onConflictDoUpdate: conflictMock,
      onConflictDoNothing: conflictDoNothingMock,
    });
    insertMock.mockReturnValue({ values: valuesMock });
    conflictMock.mockResolvedValue(undefined);
    conflictDoNothingMock.mockResolvedValue(undefined);
    returningMock.mockResolvedValue([{ id: "app" }]);
    whereMock.mockReturnValue({ returning: returningMock });
    setMock.mockReturnValue({ where: whereMock });
    updateMock.mockReturnValue({ set: setMock });
  });

  it("updates the deployment-wide query count with an atomic SQL expression", async () => {
    await incrementAppSettingsQueryCount(3);

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryCount: "increment-expression",
      }),
    );
    expect(setMock.mock.calls[0]?.[0]).not.toHaveProperty("updatedAt");
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a save built from a stale settings timestamp", async () => {
    returningMock.mockResolvedValue([]);

    await expect(upsertAppSettings("new-value", "stale-time")).resolves.toBe(
      null,
    );
    expect(updateMock).toHaveBeenCalledTimes(1);
  });
});
