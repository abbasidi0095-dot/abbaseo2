import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { incrementQueryCountMock, resolveMock } = vi.hoisted(() => ({
  incrementQueryCountMock: vi.fn(),
  resolveMock: vi.fn(),
}));

vi.mock("@/server/features/settings/SettingsRepository", () => ({
  incrementAppSettingsQueryCount: incrementQueryCountMock,
}));

vi.mock("@/server/lib/dataforseo/credential-selector", () => ({
  dataforseoCredentialSelector: { resolve: resolveMock },
}));

import {
  appendixApi,
  getDataforseoTaskCount,
  labsApi,
  recordDataforseoQueryCount,
} from "@/server/lib/dataforseo/core";

beforeEach(() => {
  vi.clearAllMocks();
  resolveMock.mockResolvedValue("test-api-key");
  incrementQueryCountMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getDataforseoTaskCount", () => {
  it("uses the provider task count when it is positive", () => {
    expect(getDataforseoTaskCount({ tasks_count: 4 })).toBe(4);
  });

  it("counts an otherwise successful provider response as one query", () => {
    expect(getDataforseoTaskCount({ tasks_count: 0 })).toBe(1);
    expect(getDataforseoTaskCount({})).toBe(1);
    expect(getDataforseoTaskCount(null)).toBe(1);
  });

  it("persists the provider task count without exposing response data", async () => {
    await recordDataforseoQueryCount(
      new Response(JSON.stringify({ tasks_count: 4 })),
    );

    expect(incrementQueryCountMock).toHaveBeenCalledWith(4);
  });
});

describe("DataForSEO response metering", () => {
  it("counts a successful non-user-data response by its task count", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ tasks_count: 4 })),
    );

    await labsApi().googleKeywordsForSiteLive([]);

    await vi.waitFor(() => {
      expect(incrementQueryCountMock).toHaveBeenCalledWith(4);
    });
  });

  it("does not count the free appendix user-data response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          status_code: 20000,
          tasks: [{ status_code: 20000, result: [{}] }],
        }),
      ),
    );

    await appendixApi().userData();

    expect(incrementQueryCountMock).not.toHaveBeenCalled();
  });

  it("returns the successful provider response when counter persistence rejects", async () => {
    incrementQueryCountMock.mockRejectedValue(
      new Error("database unavailable"),
    );
    const response = Response.json({ tasks_count: 4 });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response));

    await expect(
      labsApi().googleKeywordsForSiteLive([]),
    ).resolves.toBeDefined();
  });

  it("does not wait for counter persistence before returning the provider response", async () => {
    incrementQueryCountMock.mockReturnValue(new Promise<void>(() => {}));
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ tasks_count: 4 })),
    );

    const result = await Promise.race([
      labsApi()
        .googleKeywordsForSiteLive([])
        .then(() => "response"),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve("blocked"), 20),
      ),
    ]);

    expect(result).toBe("response");
  });

  it("routes every billable call through the credential selector", async () => {
    resolveMock.mockResolvedValue("selected-key");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ tasks_count: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await labsApi().googleKeywordsForSiteLive([]);

    expect(resolveMock).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(new Headers(init?.headers ?? []).get("Authorization")).toBe(
      "Basic selected-key",
    );
  });
});
