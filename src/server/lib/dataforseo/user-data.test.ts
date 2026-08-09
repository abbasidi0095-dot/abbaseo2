import { afterEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.stubGlobal("fetch", fetchMock);

import {
  parseUserDataAccountPayload,
  probeUserDataAccount,
} from "@/server/lib/dataforseo/user-data";

afterEach(() => {
  fetchMock.mockReset();
});

describe("parseUserDataAccountPayload", () => {
  const happyEnvelope = {
    status_code: 20000,
    tasks: [
      {
        status_code: 20000,
        result: [
          {
            login: "demo@dataforseo.com",
            money: {
              balance: 42.5,
              total: 100,
              statistics: {
                day: { total: 3.25 },
                minute: { total: 0.5 },
              },
            },
          },
        ],
      },
    ],
  };

  it("extracts balance, totals, spend, and login from a successful envelope", () => {
    expect(parseUserDataAccountPayload(happyEnvelope)).toEqual({
      login: "demo@dataforseo.com",
      balance: 42.5,
      total: 100,
      daySpend: 3.25,
      minuteSpend: 0.5,
    });
  });

  it("returns null for malformed envelopes", () => {
    expect(parseUserDataAccountPayload({})).toBeNull();
    expect(parseUserDataAccountPayload({ status_code: 20000 })).toBeNull();
    expect(
      parseUserDataAccountPayload({
        status_code: 20000,
        tasks: [{ status_code: 40000 }],
      }),
    ).toBeNull();
    expect(
      parseUserDataAccountPayload({
        status_code: 20000,
        tasks: [{ status_code: 20000, result: [{}] }],
      }),
    ).toBeNull();
  });
});

describe("probeUserDataAccount", () => {
  it("sends a Basic header and returns the parsed account", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        status_code: 20000,
        tasks: [
          {
            status_code: 20000,
            result: [{ money: { balance: 7, total: 9 } }],
          },
        ],
      }),
    );

    const result = await probeUserDataAccount("dGVzdDpwdw==");

    expect(result.invalid).toBe(false);
    expect(result.account?.balance).toBe(7);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.dataforseo.com/v3/appendix/user_data",
      expect.objectContaining({
        headers: { Authorization: "Basic dGVzdDpwdw==" },
      }),
    );
  });

  it("flags 401/403 as invalid credentials", async () => {
    fetchMock.mockResolvedValue(new Response("Unauthorized", { status: 401 }));

    const result = await probeUserDataAccount("bad");

    expect(result).toEqual({ account: null, invalid: true });
  });

  it("returns account null (not invalid) on non-auth failures", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));

    const result = await probeUserDataAccount("dGVzdDpwdw==");

    expect(result).toEqual({ account: null, invalid: false });
  });

  it("returns account null (not invalid) when the network fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const result = await probeUserDataAccount("dGVzdDpwdw==");

    expect(result).toEqual({ account: null, invalid: false });
  });
});