import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadAppSettingsMock, getOptionalEnvValueMock } = vi.hoisted(() => ({
  loadAppSettingsMock: vi.fn(),
  getOptionalEnvValueMock: vi.fn(),
}));

vi.mock("@/server/features/settings/SettingsService", () => ({
  loadAppSettings: loadAppSettingsMock,
}));

vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: getOptionalEnvValueMock,
}));

import {
  DataforseoCredentialSelector,
  loadConfiguredDataforseoCredentials,
  type ProbeResult,
  type ResolvedDataforseoCredential,
} from "@/server/lib/dataforseo/credential-selector";

function cred(id: string): ResolvedDataforseoCredential {
  return { id, login: `login-${id}`, encoded: `enc-${id}`, fromEnv: false };
}

function makeProbe(
  balances: Record<string, number | null | "invalid">,
): vi.Mock<() => Promise<ProbeResult>> {
  return vi.fn(async (encoded: string) => {
    const value = balances[encoded];
    if (value === "invalid") return { balance: null, invalid: true };
    return { balance: value ?? null, invalid: false };
  });
}

function makeSelector(
  credentials: ResolvedDataforseoCredential[],
  probe: vi.Mock<() => Promise<ProbeResult>>,
  ttlMs = 60_000,
) {
  return new DataforseoCredentialSelector({
    ttlMs,
    loadCredentials: vi.fn(async () => credentials),
    probeBalance: probe,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("DataforseoCredentialSelector.resolve", () => {
  it("picks the credential with the highest positive balance", async () => {
    const balances = { "enc-a": 5, "enc-b": 20, "enc-c": 10 };
    const selector = makeSelector(
      [cred("a"), cred("b"), cred("c")],
      makeProbe(balances),
    );

    expect(await selector.resolve()).toBe("enc-b");
  });

  it("breaks ties toward the earlier list position", async () => {
    const balances = { "enc-a": 10, "enc-b": 10 };
    const selector = makeSelector([cred("a"), cred("b")], makeProbe(balances));

    expect(await selector.resolve()).toBe("enc-a");
  });

  it("falls back to the primary credential when all balances are zero", async () => {
    const balances = { "enc-a": 0, "enc-b": 0 };
    const selector = makeSelector([cred("a"), cred("b")], makeProbe(balances));

    expect(await selector.resolve()).toBe("enc-a");
  });

  it("falls back to the primary when balances are unknown", async () => {
    const selector = makeSelector(
      [cred("a"), cred("b")],
      makeProbe({ "enc-a": null, "enc-b": null }),
    );

    expect(await selector.resolve()).toBe("enc-a");
  });

  it("skips invalid (401) credentials even when they have the highest balance", async () => {
    const balances = { "enc-a": "invalid", "enc-b": 3 };
    const selector = makeSelector([cred("a"), cred("b")], makeProbe(balances));

    expect(await selector.resolve()).toBe("enc-b");
  });

  it("uses the primary even when every credential is invalid (attempt-anyway)", async () => {
    const balances = { "enc-a": "invalid", "enc-b": "invalid" };
    const selector = makeSelector([cred("a"), cred("b")], makeProbe(balances));

    expect(await selector.resolve()).toBe("enc-a");
  });

  it("caches balances for the TTL and probes again after it expires", async () => {
    const probe = makeProbe({ "enc-a": 10, "enc-b": 20 });
    const selector = makeSelector([cred("a"), cred("b")], probe, 60_000);

    await selector.resolve();
    expect(probe).toHaveBeenCalledTimes(2);

    await selector.resolve();
    expect(probe).toHaveBeenCalledTimes(2);

    vi.setSystemTime(Date.now() + 61_000);
    await selector.resolve();
    expect(probe).toHaveBeenCalledTimes(4);
  });

  it("re-probes immediately after invalidateCache", async () => {
    const probe = makeProbe({ "enc-a": 10, "enc-b": 20 });
    const selector = makeSelector([cred("a"), cred("b")], probe);

    await selector.resolve();
    expect(probe).toHaveBeenCalledTimes(2);

    selector.invalidateCache();
    await selector.resolve();
    expect(probe).toHaveBeenCalledTimes(4);
  });

  it("throws when no credentials are configured", async () => {
    const selector = makeSelector([], makeProbe({}));

    await expect(selector.resolve()).rejects.toThrow(
      "Missing required environment variable: DATAFORSEO_API_KEY",
    );
  });
});

describe("loadConfiguredDataforseoCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns settings credentials first, env var appended last", async () => {
    loadAppSettingsMock.mockResolvedValue({
      dataforseo: {
        credentials: [
          { id: "cred-1", login: "a@b.com", password: "pw" },
          { id: "cred-2", login: "c@d.com", password: "pw2" },
          { id: "cred-3", login: "", password: "" },
        ],
      },
    });
    getOptionalEnvValueMock.mockResolvedValue("ZXZAdGVzdC5jb206ZW52cHc=");

    const credentials = await loadConfiguredDataforseoCredentials();

    expect(credentials).toEqual([
      {
        id: "cred-1",
        login: "a@b.com",
        encoded: "YUBiLmNvbTpwdw==",
        fromEnv: false,
      },
      {
        id: "cred-2",
        login: "c@d.com",
        encoded: "Y0BkLmNvbTpwdzI=",
        fromEnv: false,
      },
      {
        id: "__env__",
        login: "ev@test.com",
        encoded: "ZXZAdGVzdC5jb206ZW52cHc=",
        fromEnv: true,
      },
    ]);
  });

  it("returns env-only credentials when the settings store is empty", async () => {
    loadAppSettingsMock.mockResolvedValue({ dataforseo: { credentials: [] } });
    getOptionalEnvValueMock.mockResolvedValue("b25seS1lbnY=");

    const credentials = await loadConfiguredDataforseoCredentials();

    expect(credentials).toEqual([
      { id: "__env__", login: "", encoded: "b25seS1lbnY=", fromEnv: true },
    ]);
  });

  it("returns an empty list when nothing is configured", async () => {
    loadAppSettingsMock.mockResolvedValue({ dataforseo: { credentials: [] } });
    getOptionalEnvValueMock.mockResolvedValue(undefined);

    expect(await loadConfiguredDataforseoCredentials()).toEqual([]);
  });
});