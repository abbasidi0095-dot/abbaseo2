import { z } from "zod";

// DataForSEO's free account-data endpoint: returns lifetime deposits, remaining
// balance, and rolling day/minute spend. See AppendixApi.userData().
export const DATAFORSEO_USER_DATA_URL =
  "https://api.dataforseo.com/v3/appendix/user_data";

const USER_DATA_TIMEOUT_MS = 15_000;

export type DataforseoUserDataAccount = {
  login?: string;
  balance: number;
  total: number;
  daySpend: number;
  minuteSpend: number;
};

const userDataEnvelopeSchema = z.object({
  status_code: z.number(),
  tasks: z
    .array(
      z.object({
        status_code: z.number(),
        result: z
          .array(
            z.object({
              login: z.string().optional(),
              money: z
                .object({
                  balance: z.number().optional(),
                  total: z.number().optional(),
                  statistics: z
                    .object({
                      day: z
                        .object({ total: z.number().optional() })
                        .optional(),
                      minute: z
                        .object({ total: z.number().optional() })
                        .optional(),
                    })
                    .optional(),
                })
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

/**
 * Parses the /v3/appendix/user_data HTTP 200 body into account numbers.
 * Returns null when the envelope is malformed or reports a non-20000 task.
 */
export function parseUserDataAccountPayload(
  value: unknown,
): DataforseoUserDataAccount | null {
  const parsed = userDataEnvelopeSchema.safeParse(value);
  const task = parsed.success ? parsed.data.tasks?.[0] : undefined;
  if (!parsed.success || parsed.data.status_code !== 20000) return null;
  if (!task || task.status_code !== 20000) return null;
  const result = task.result?.[0];
  if (!result?.money) return null;
  return {
    login: result.login,
    balance: result.money.balance ?? 0,
    total: result.money.total ?? 0,
    daySpend: result.money.statistics?.day?.total ?? 0,
    minuteSpend: result.money.statistics?.minute?.total ?? 0,
  };
}

/**
 * Raw balance probe for the credential selector. Uses plain fetch with an
 * explicit Basic header and NEVER routes through createAuthenticatedFetch,
 * which would recurse into the selector. 401/403 means the credential itself
 * is invalid; everything else (network error, 5xx, unparseable body) means
 * "balance unknown".
 */
export async function probeUserDataAccount(
  encodedKey: string,
): Promise<{ account: DataforseoUserDataAccount | null; invalid: boolean }> {
  try {
    const response = await fetch(DATAFORSEO_USER_DATA_URL, {
      headers: { Authorization: `Basic ${encodedKey}` },
      signal: AbortSignal.timeout(USER_DATA_TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) {
      return { account: null, invalid: true };
    }
    if (!response.ok) {
      return { account: null, invalid: false };
    }
    const body: unknown = await response.json();
    return { account: parseUserDataAccountPayload(body), invalid: false };
  } catch {
    return { account: null, invalid: false };
  }
}
