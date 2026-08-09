# Multi-Credential DataForSEO with Balance-Based Rotation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support up to 10 DataForSEO credentials per deployment with automatic, proactive fallback to the highest-balance credential when an account's topup hits zero.

**Architecture:** A `DataforseoCredentialSelector` sits at the single auth choke point (`createAuthenticatedFetch` in `src/server/lib/dataforseo/core.ts`). It loads the credential list (settings-store list first, `DATAFORSEO_API_KEY` env var appended as implicit last entry), probes each credential's balance via the free `/v3/appendix/user_data` endpoint (60s per-credential cache, raw fetch — no selector recursion), picks the highest balance > 0, and falls back to the primary (first) credential when all are 0/unknown/invalid. Storage is backward compatible: the `app_settings` JSON payload gains `dataforseo.credentials[]`; a legacy `{login, password}` payload is migrated on read via a zod transform. All 26 billable call sites ride the choke point unchanged.

**Tech Stack:** TypeScript, TanStack server functions, zod, vitest, React (+ daisyUI classes), drizzle app_settings row, dataforseo-client SDK.

**Spec:** `docs/superpowers/specs/2026-08-09-multi-dataforseo-creds-fallback-design.md`

## Global Constraints

- Credential cap: exactly 10 settings-store credentials max (`z.array(...).max(10)`).
- Legacy payload shape `{login, password}` must keep parsing — migrate on read, never break stored rows.
- Selection rule: highest cached balance > 0 wins; ties → earlier list position; all ≤ 0 or unknown → attempt-anyway with primary (first in list: settings[0], else env).
- Balance probe MUST use raw `fetch` with an explicit Basic header — it must never route through `createAuthenticatedFetch` (would recurse into the selector).
- Balance cache TTL: 60s per credential; cleared on settings save.
- `user_data` probe endpoint: `https://api.dataforseo.com/v3/appendix/user_data`, 15s timeout.
- Password/secrets never leave the server: public schema exposes `{id, login}` only.
- Keep `parseDataforseoTestResponse` export name in `src/serverFunctions/settings.ts` (tested by `settings.test.ts`).
- Existing tests must keep passing: `core.test.ts`, `settings.test.ts`, `SettingsPersistence.test.ts`.
- Test runner: `pnpm vitest run <path>`. Typecheck: `pnpm types:check` (`tsc --noEmit`).

---

### Task 1: Shared user_data parser + raw probe (`src/server/lib/dataforseo/user-data.ts`)

**Files:**
- Create: `src/server/lib/dataforseo/user-data.ts`
- Test: `src/server/lib/dataforseo/user-data.test.ts`
- Modify: `src/serverFunctions/settings.ts:29-61` (delegate parser, reuse URL constant)

**Interfaces:**
- Produces: `DATAFORSEO_USER_DATA_URL: string`, `DataforseoUserDataAccount = { login?: string; balance: number; total: number; daySpend: number; minuteSpend: number }`, `parseUserDataAccountPayload(value: unknown): DataforseoUserDataAccount | null`, `probeUserDataAccount(encodedKey: string): Promise<{ account: DataforseoUserDataAccount | null; invalid: boolean }>`.
- Consumed by: Task 4 (selector), Task 6/7 (server functions).

- [ ] **Step 1: Write the failing test**

Create `src/server/lib/dataforseo/user-data.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/server/lib/dataforseo/user-data.test.ts`
Expected: FAIL — module `@/server/lib/dataforseo/user-data` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/server/lib/dataforseo/user-data.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/server/lib/dataforseo/user-data.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Delegate the settings-page parser to the shared one**

In `src/serverFunctions/settings.ts`:

Replace the import block (line 1-21) — keep the existing imports and add:

```ts
import {
  DATAFORSEO_USER_DATA_URL,
  parseUserDataAccountPayload,
} from "@/server/lib/dataforseo/user-data";
```

Delete the local `DATAFORSEO_USER_DATA_URL` constant (line 29-30) and the local `dataforseoTestResponseSchema` + `parseDataforseoTestResponse` (lines 34-61), replacing them with:

```ts
export function parseDataforseoTestResponse(
  value: unknown,
): { balance: number | null } | null {
  const account = parseUserDataAccountPayload(value);
  return account ? { balance: account.balance } : null;
}
```

- [ ] **Step 6: Run the settings tests to verify no regression**

Run: `pnpm vitest run src/serverFunctions/settings.test.ts`
Expected: PASS — 3 tests (the `parseDataforseoTestResponse` cases must still pass).

- [ ] **Step 7: Commit**

```bash
git add src/server/lib/dataforseo/user-data.ts src/server/lib/dataforseo/user-data.test.ts src/serverFunctions/settings.ts
git commit -m "feat(dataforseo): shared user_data parser and raw balance probe"
```

---

### Task 2: Schema migration — `credentials` array payload (legacy transform)

**Files:**
- Modify: `src/server/features/settings/appSettingsSchema.ts`
- Test: `src/server/features/settings/appSettingsSchema.test.ts` (create)

**Interfaces:**
- Produces: `dataforseoSettingsSchema` accepts both `{login, password}` (legacy) and `{credentials: [{id, login, password}]}` (max 10) and always transforms to `{credentials: [...]}`. `DataForSeoSettings = { credentials: Array<{id, login, password}> }`. `publicAppSettingsSchema.dataforseo = { configured: boolean, credentials: Array<{id, login}>, envConfigured: boolean }`. `DEFAULT_APP_SETTINGS_PAYLOAD.dataforseo = { credentials: [] }`.
- Consumed by: Task 3 (SettingsService), Task 6 (serverFunctions).

- [ ] **Step 1: Write the failing test**

Create `src/server/features/settings/appSettingsSchema.test.ts`:

```ts
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
    const parsed = appSettingsPayloadSchema.parse(
      DEFAULT_APP_SETTINGS_PAYLOAD,
    );
    expect(parsed.dataforseo.credentials).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/server/features/settings/appSettingsSchema.test.ts`
Expected: FAIL — legacy shape is rejected (no union/transform yet).

- [ ] **Step 3: Implement the schema migration**

In `src/server/features/settings/appSettingsSchema.ts`:

Replace lines 3-9 (the comment block + `dataforseoSettingsSchema`) with:

```ts
// Deployment-wide settings managed from the Settings screen. One payload per
// deployment, persisted as a single encrypted JSON row in `app_settings`.
// Empty strings mean "unset" (never stored as null so the UI round-trips).
//
// DataForSEO supports MULTIPLE credentials (up to 10): the app probes each
// account's balance and routes billable calls to the account with the most
// remaining topup, falling back to the next when an account hits zero. The
// legacy single-pair shape `{login, password}` still parses — it migrates to
// a one-element credentials list on read.
const dataforseoCredentialSchema = z.object({
  id: z.string().min(1).max(64),
  login: z.string().max(255),
  password: z.string().max(1024),
});

const legacyDataforseoSettingsSchema = z.object({
  login: z.string().max(255),
  password: z.string().max(1024),
});

export const dataforseoSettingsSchema = z
  .union([
    legacyDataforseoSettingsSchema,
    z.object({
      credentials: z.array(dataforseoCredentialSchema).max(10),
    }),
  ])
  .transform((value) => {
    if ("credentials" in value) return value;
    if (!value.login && !value.password) return { credentials: [] };
    return {
      credentials: [
        {
          id: "legacy-1",
          login: value.login,
          password: value.password,
        },
      ],
    };
  });
```

Replace `appSettingsPayloadSchema` (lines 26-30) — it already references `dataforseoSettingsSchema`, no change needed there.

Replace lines 32-34 — keep `AppSettingsPayload`; `DataForSeoSettings` now infers the transformed shape:

```ts
export type AppSettingsPayload = z.infer<typeof appSettingsPayloadSchema>;
export type DataForSeoSettings = z.infer<typeof dataforseoSettingsSchema>;
export type AiSettings = z.infer<typeof aiSettingsSchema>;
```

Replace `DEFAULT_APP_SETTINGS_PAYLOAD` (lines 36-51) `dataforseo` field:

```ts
export const DEFAULT_APP_SETTINGS_PAYLOAD: AppSettingsPayload = {
  dataforseo: { credentials: [] },
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
};
```

Replace the public schema `dataforseo` block (lines 56-71):

```ts
export const publicAppSettingsSchema = z.object({
  updatedAt: z.string().nullable(),
  dataforseo: z.object({
    configured: z.boolean(),
    credentials: z.array(
      z.object({ id: z.string(), login: z.string() }),
    ),
    envConfigured: z.boolean(),
  }),
  ai: z.object({
    openrouterConfigured: z.boolean(),
    openaiConfigured: z.boolean(),
    anthropicConfigured: z.boolean(),
    defaultModel: z.string(),
    temperature: z.number(),
    maxTokens: z.number(),
  }),
  branding: brandingSettingsSchema,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/server/features/settings/appSettingsSchema.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Fix the persistence test's shape assertion**

In `src/server/features/settings/SettingsPersistence.test.ts:40`, replace:

```ts
    expect(snapshot.payload.dataforseo.password).toBe("");
```

with:

```ts
    expect(snapshot.payload.dataforseo.credentials).toEqual([]);
```

- [ ] **Step 6: Run the persistence tests**

Run: `pnpm vitest run src/server/features/settings/SettingsPersistence.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 7: Commit**

```bash
git add src/server/features/settings/appSettingsSchema.ts src/server/features/settings/appSettingsSchema.test.ts src/server/features/settings/SettingsPersistence.test.ts
git commit -m "feat(settings): migrate DataForSEO settings to a credentials array"
```

---

### Task 3: SettingsService — per-credential merge, primary resolution, save normalization

**Files:**
- Modify: `src/server/features/settings/SettingsService.ts:52-71` (merge), `:191-206` (save normalization), `:242-247` (getDynamicSecretValue)
- Test: `src/server/features/settings/SettingsService.test.ts` (create)

**Interfaces:**
- Consumes: Task 2 schema (`DataForSeoSettings`, legacy transform).
- Produces: `mergeAppSettingsSecrets` merges by credential id (blank incoming secret keeps existing), prunes rows where login AND password are both empty; `getDynamicSecretValue("DATAFORSEO_API_KEY")` returns the encoded PRIMARY credential (first with non-empty login+password); `saveAppSettingsPayload` prunes empty credential rows; `generateDefaultPayload(): AppSettingsPayload` (exported clone of the default payload).
- Consumed by: Task 4 (selector), Task 6 (serverFunctions save handler).

- [ ] **Step 1: Write the failing test**

Create `src/server/features/settings/SettingsService.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  generateDefaultPayload,
  mergeAppSettingsSecrets,
} from "@/server/features/settings/SettingsService";

function makePayload(
  credentials: Array<{ id: string; login: string; password: string }>,
) {
  const payload = generateDefaultPayload();
  payload.dataforseo.credentials = credentials;
  return payload;
}

describe("mergeAppSettingsSecrets (dataforseo credentials)", () => {
  it("keeps the existing password when the incoming row leaves it blank", () => {
    const current = makePayload([
      { id: "cred-1", login: "a@b.com", password: "super-secret" },
    ]);
    const input = makePayload([
      { id: "cred-1", login: "a@b.com", password: "" },
    ]);

    const merged = mergeAppSettingsSecrets(current, input);

    expect(merged.dataforseo.credentials).toEqual([
      { id: "cred-1", login: "a@b.com", password: "super-secret" },
    ]);
  });

  it("replaces the password when the incoming row sets one", () => {
    const current = makePayload([
      { id: "cred-1", login: "a@b.com", password: "old" },
    ]);
    const input = makePayload([
      { id: "cred-1", login: "a@b.com", password: "new" },
    ]);

    const merged = mergeAppSettingsSecrets(current, input);

    expect(merged.dataforseo.credentials[0].password).toBe("new");
  });

  it("adds new credentials and drops rows with neither login nor password", () => {
    const current = makePayload([]);
    const input = makePayload([
      { id: "cred-1", login: "a@b.com", password: "pw" },
      { id: "cred-2", login: "", password: "" },
      { id: "cred-3", login: "c@d.com", password: "" },
    ]);

    const merged = mergeAppSettingsSecrets(current, input);

    expect(merged.dataforseo.credentials).toEqual([
      { id: "cred-1", login: "a@b.com", password: "pw" },
      { id: "cred-3", login: "c@d.com", password: "" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/server/features/settings/SettingsService.test.ts`
Expected: FAIL — `generateDefaultPayload` not exported / merge keeps the old single-pair shape.

- [ ] **Step 3: Implement the merge + normalization**

In `src/server/features/settings/SettingsService.ts`:

Add an exported default-payload factory (near `emptyPayload`, line 48-50):

```ts
export function generateDefaultPayload(): AppSettingsPayload {
  return structuredClone(DEFAULT_APP_SETTINGS_PAYLOAD);
}

function emptyPayload(): AppSettingsPayload {
  return generateDefaultPayload();
}
```

Replace `mergeAppSettingsSecrets` (lines 52-71) with:

```ts
export function mergeAppSettingsSecrets(
  current: AppSettingsPayload,
  input: AppSettingsPayload,
): AppSettingsPayload {
  return {
    ...input,
    dataforseo: {
      credentials: mergeDataforseoCredentials(
        current.dataforseo.credentials,
        input.dataforseo.credentials,
      ),
    },
    ai: {
      ...input.ai,
      openrouterApiKey:
        input.ai.openrouterApiKey || current.ai.openrouterApiKey,
      openaiApiKey: input.ai.openaiApiKey || current.ai.openaiApiKey,
      anthropicApiKey: input.ai.anthropicApiKey || current.ai.anthropicApiKey,
    },
  };
}

/**
 * Merges credential rows by id: a blank incoming login/password keeps the
 * existing value. Rows where BOTH login and password are empty are dropped.
 */
function mergeDataforseoCredentials(
  current: DataForSeoSettings["credentials"],
  incoming: DataForSeoSettings["credentials"],
): DataForSeoSettings["credentials"] {
  return incoming
    .map((credential) => {
      const existing = current.find((entry) => entry.id === credential.id);
      return {
        id: credential.id,
        login: credential.login || existing?.login || "",
        password: credential.password || existing?.password || "",
      };
    })
    .filter(
      (credential) =>
        credential.login !== "" || credential.password !== "",
    );
}
```

Add the `DataForSeoSettings` type import to the imports at the top of the file:

```ts
import {
  appSettingsPayloadSchema,
  DEFAULT_APP_SETTINGS_PAYLOAD,
  type AppSettingsPayload,
  type DataForSeoSettings,
} from "@/server/features/settings/appSettingsSchema";
```

In `saveAppSettingsPayload`, replace the normalization block (lines 191-206):

```ts
  const normalized = { ...parsed };
  // Prune unset secrets to empty strings so the UI never round-trips nulls.
  const dataforseo = { ...parsed.dataforseo };
  const ai = { ...parsed.ai };
  for (const key of ["login", "password"] as const) {
    dataforseo[key] = dataforseo[key] ?? "";
  }
  for (const key of [
    "openrouterApiKey",
    "openaiApiKey",
    "anthropicApiKey",
  ] as const) {
    ai[key] = ai[key] ?? "";
  }
  normalized.dataforseo = dataforseo;
  normalized.ai = ai;
```

with:

```ts
  const normalized = { ...parsed };
  // Prune unset secrets to empty strings so the UI never round-trips nulls.
  normalized.dataforseo = {
    credentials: parsed.dataforseo.credentials.filter(
      (credential) =>
        credential.login !== "" || credential.password !== "",
    ),
  };
  const ai = { ...parsed.ai };
  for (const key of [
    "openrouterApiKey",
    "openaiApiKey",
    "anthropicApiKey",
  ] as const) {
    ai[key] = ai[key] ?? "";
  }
  normalized.ai = ai;
```

In `getDynamicSecretValue`, replace the `DATAFORSEO_API_KEY` case (lines 241-248):

```ts
    case "DATAFORSEO_API_KEY": {
      const primary = payload.dataforseo.credentials.find(
        (credential) => credential.login && credential.password,
      );
      if (primary) {
        return encodeDataforseoApiKey(primary.login, primary.password);
      }
      return undefined;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/server/features/settings/SettingsService.test.ts src/server/features/settings/SettingsPersistence.test.ts`
Expected: PASS — 3 + 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/features/settings/SettingsService.ts src/server/features/settings/SettingsService.test.ts
git commit -m "feat(settings): merge and normalize multiple DataForSEO credentials"
```

---

### Task 4: The credential selector (`src/server/lib/dataforseo/credential-selector.ts`)

**Files:**
- Create: `src/server/lib/dataforseo/credential-selector.ts`
- Test: `src/server/lib/dataforseo/credential-selector.test.ts`

**Interfaces:**
- Consumes: Task 1 `probeUserDataAccount`, Task 3 `loadAppSettings`, `getOptionalEnvValue` (runtime-env), Task 2 schema type.
- Produces: `ResolvedDataforseoCredential = { id: string; login: string; encoded: string; fromEnv: boolean }`; class `DataforseoCredentialSelector` with `resolve(): Promise<string>`, `listResolvedCredentials(): Promise<ResolvedDataforseoCredential[]>`, `invalidateCache(): void`; singleton `dataforseoCredentialSelector`; helper `loadConfiguredDataforseoCredentials(): Promise<ResolvedDataforseoCredential[]>` (exported for tests).
- Consumed by: Task 5 (`core.ts`), Task 6 (usage SF), Task 7 (balance SF).

- [ ] **Step 1: Write the failing test**

Create `src/server/lib/dataforseo/credential-selector.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/server/lib/dataforseo/credential-selector.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the selector**

Create `src/server/lib/dataforseo/credential-selector.ts`:

```ts
import { loadAppSettings } from "@/server/features/settings/SettingsService";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { probeUserDataAccount } from "@/server/lib/dataforseo/user-data";

const CACHE_TTL_MS = 60_000;
const ENV_CREDENTIAL_ID = "__env__";

export type ResolvedDataforseoCredential = {
  id: string;
  login: string;
  encoded: string;
  fromEnv: boolean;
};

export type ProbeResult = {
  balance: number | null;
  invalid: boolean;
};

type BalanceSnapshot = ProbeResult & { checkedAt: number };

type SelectorDeps = {
  ttlMs?: number;
  loadCredentials: () => Promise<ResolvedDataforseoCredential[]>;
  probeBalance: (encoded: string) => Promise<ProbeResult>;
};

/**
 * Picks the DataForSEO credential for each billable request.
 *
 * Loads the credential list (settings-store first, env var appended as the
 * implicit last entry), probes balances through the free user_data endpoint
 * (60s per-credential cache), and returns the highest positive balance.
 * When every balance is zero/unknown/invalid it attempts the call anyway
 * with the PRIMARY credential (first in the list: settings[0], else env).
 *
 * This is the only place that resolves `DATAFORSEO_API_KEY` for the SDK's
 * authenticated fetch; the balance probe bypasses the SDK (raw fetch) so
 * there is no recursion.
 */
export class DataforseoCredentialSelector {
  private readonly ttlMs: number;
  private readonly loadCredentials: () => Promise<
    ResolvedDataforseoCredential[]
  >;
  private readonly probeBalance: (encoded: string) => Promise<ProbeResult>;
  private readonly cache = new Map<string, BalanceSnapshot>();

  constructor(deps: SelectorDeps) {
    this.ttlMs = deps.ttlMs ?? CACHE_TTL_MS;
    this.loadCredentials = deps.loadCredentials;
    this.probeBalance = deps.probeBalance;
  }

  async resolve(): Promise<string> {
    const credentials = await this.loadCredentials();
    if (credentials.length === 0) {
      throw new Error(
        "Missing required environment variable: DATAFORSEO_API_KEY",
      );
    }

    const evaluated = await Promise.all(
      credentials.map(async (credential) => ({
        credential,
        snapshot: await this.snapshotFor(credential),
      })),
    );

    const withFunds = evaluated.filter(
      ({ snapshot }) =>
        !snapshot.invalid &&
        snapshot.balance !== null &&
        snapshot.balance > 0,
    );

    if (withFunds.length > 0) {
      // Reduce keeps the EARLIER candidate on ties, so equal balances prefer
      // the earlier list position.
      const chosen = withFunds.reduce((best, candidate) =>
        (candidate.snapshot.balance ?? 0) > (best.snapshot.balance ?? 0)
          ? candidate
          : best,
      );
      return chosen.credential.encoded;
    }

    // All zero / unknown / invalid: attempt-anyway with the primary key.
    return credentials[0].encoded;
  }

  async listResolvedCredentials(): Promise<ResolvedDataforseoCredential[]> {
    return this.loadCredentials();
  }

  /** Drop all balance snapshots (call after saving settings). */
  invalidateCache(): void {
    this.cache.clear();
  }

  private async snapshotFor(
    credential: ResolvedDataforseoCredential,
  ): Promise<BalanceSnapshot> {
    const cached = this.cache.get(credential.id);
    if (cached && Date.now() - cached.checkedAt < this.ttlMs) {
      return cached;
    }
    const probe = await this.probeBalance(credential.encoded);
    const snapshot: BalanceSnapshot = { ...probe, checkedAt: Date.now() };
    this.cache.set(credential.id, snapshot);
    return snapshot;
  }
}

/**
 * Loads the effective credential list: settings-store rows that have both a
 * login and password (in stored order), then the DATAFORSEO_API_KEY env var
 * as one implicit final credential when present.
 */
export async function loadConfiguredDataforseoCredentials(): Promise<
  ResolvedDataforseoCredential[]
> {
  const [payload, envKey] = await Promise.all([
    loadAppSettings().catch(() => undefined),
    getOptionalEnvValue("DATAFORSEO_API_KEY"),
  ]);

  const credentials: ResolvedDataforseoCredential[] =
    (payload?.dataforseo?.credentials ?? [])
      .filter((credential) => credential.login && credential.password)
      .map((credential) => ({
        id: credential.id,
        login: credential.login,
        encoded: btoa(`${credential.login}:${credential.password}`),
        fromEnv: false,
      }));

  if (envKey) {
    credentials.push({
      id: ENV_CREDENTIAL_ID,
      login: decodeEnvLogin(envKey),
      encoded: envKey,
      fromEnv: true,
    });
  }
  return credentials;
}

function decodeEnvLogin(encodedKey: string): string {
  // The env key is base64(login:password) when it follows the documented
  // format; some deployments store a raw dashboard key — degrade gracefully.
  try {
    return atob(encodedKey).split(":")[0] ?? "";
  } catch {
    return "";
  }
}

export const dataforseoCredentialSelector = new DataforseoCredentialSelector({
  loadCredentials: loadConfiguredDataforseoCredentials,
  probeBalance: async (encoded): Promise<ProbeResult> => {
    const { account, invalid } = await probeUserDataAccount(encoded);
    return { balance: account?.balance ?? null, invalid };
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/server/lib/dataforseo/credential-selector.test.ts`
Expected: PASS — 12 tests (9 class + 3 loader).

- [ ] **Step 5: Typecheck**

Run: `pnpm types:check`
Expected: clean (no output).

- [ ] **Step 6: Commit**

```bash
git add src/server/lib/dataforseo/credential-selector.ts src/server/lib/dataforseo/credential-selector.test.ts
git commit -m "feat(dataforseo): balance-aware credential selector with 60s cache"
```

---

### Task 5: Wire the selector into the auth choke point (`core.ts`)

**Files:**
- Modify: `src/server/lib/dataforseo/core.ts:12,104`
- Modify: `src/server/lib/dataforseo/core.test.ts`

**Interfaces:**
- Consumes: Task 4 singleton `dataforseoCredentialSelector`.
- Produces: `createAuthenticatedFetch` resolves auth via `dataforseoCredentialSelector.resolve()`. All 26 billable call sites covered; the raw probe path (`user-data.ts`) stays outside.
- Consumed by: everything calling `labsApi()/serpApi()/...` — no caller changes.

- [ ] **Step 1: Update the core wiring**

In `src/server/lib/dataforseo/core.ts`:

Replace the import on line 12:

```ts
import { getDynamicRequiredEnvValue } from "@/server/features/settings/SettingsService";
```

with:

```ts
import { dataforseoCredentialSelector } from "@/server/lib/dataforseo/credential-selector";
```

Replace lines 100-106 in `createAuthenticatedFetch`:

```ts
    // The selector picks the DataForSEO account with the most topup remaining
    // (settings-store credentials first, then the DATAFORSEO_API_KEY env var),
    // falling back to the primary key when no account has a positive balance.
    // Its balance probes use raw fetch, so this never recurses.
    const apiKey = await dataforseoCredentialSelector.resolve();
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Basic ${apiKey}`);
```

- [ ] **Step 2: Update `core.test.ts` mocks**

Replace the hoisted mocks + module mocks (lines 3-16):

```ts
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
```

Replace `beforeEach` (lines 25-29):

```ts
beforeEach(() => {
  vi.clearAllMocks();
  resolveMock.mockResolvedValue("test-api-key");
  incrementQueryCountMock.mockResolvedValue(undefined);
});
```

- [ ] **Step 3: Add a regression test that resolve() is used**

Append inside `src/server/lib/dataforseo/core.test.ts`, in the `describe("DataForSEO response metering")` block:

```ts
  it("routes every billable call through the credential selector", async () => {
    resolveMock.mockResolvedValue("selected-key");
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ tasks_count: 1 })),
    );

    await labsApi().googleKeywordsForSiteLive([]);

    expect(resolveMock).toHaveBeenCalled();
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init.headers as Headers).get("Authorization")).toBe(
      "Basic selected-key",
    );
  });
```

- [ ] **Step 4: Run core tests**

Run: `pnpm vitest run src/server/lib/dataforseo/core.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/dataforseo/core.ts src/server/lib/dataforseo/core.test.ts
git commit -m "feat(dataforseo): route auth through the credential selector"
```

---

### Task 6: Server functions — save validator, redact, usage breakdown, cache invalidation

**Files:**
- Modify: `src/serverFunctions/settings.ts`
- Test: `src/serverFunctions/settings.test.ts` (append validator-shape tests)

**Interfaces:**
- Consumes: Task 2 public schema, Task 3 merge/save, Task 4 `dataforseoCredentialSelector` + `loadConfiguredDataforseoCredentials`, Task 1 `probeUserDataAccount`.
- Produces: `saveAppSettings` accepts `{credentials[]}` or legacy `{login,password}` and invalidates the selector cache; `getAppSettings` redacts to `{configured, credentials: [{id, login}], envConfigured}`; `getDataforseoUsage` returns `{ credentials: Array<{id, login, fromEnv, invalid, balance, total, daySpend, minuteSpend}>, queriesUsed }`.
- Consumed by: Task 8/9 (client).

- [ ] **Step 1: Update imports + redact**

In `src/serverFunctions/settings.ts`:

Add to the import block (keep existing):

```ts
import {
  dataforseoCredentialSelector,
  loadConfiguredDataforseoCredentials,
} from "@/server/lib/dataforseo/credential-selector";
import { probeUserDataAccount } from "@/server/lib/dataforseo/user-data";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
```

Replace the `redact` function (lines 81-113):

```ts
async function redact(
  payload: Awaited<ReturnType<typeof loadAppSettings>>,
  updatedAt: string | null,
): Promise<PublicAppSettings> {
  const [
    dataforseoConfigured,
    openrouterConfigured,
    openaiConfigured,
    anthropicConfigured,
    envConfigured,
  ] = await Promise.all([
    isDynamicSecretConfigured("DATAFORSEO_API_KEY"),
    isDynamicSecretConfigured("OPENROUTER_API_KEY"),
    isDynamicSecretConfigured("OPENAI_API_KEY"),
    isDynamicSecretConfigured("ANTHROPIC_API_KEY"),
    getOptionalEnvValue("DATAFORSEO_API_KEY").then(Boolean),
  ]);

  return publicAppSettingsSchema.parse({
    updatedAt,
    dataforseo: {
      configured: dataforseoConfigured,
      credentials: payload.dataforseo.credentials.map((credential) => ({
        id: credential.id,
        login: credential.login,
      })),
      envConfigured,
    },
    ai: {
      openrouterConfigured,
      openaiConfigured,
      anthropicConfigured,
      defaultModel: payload.ai?.defaultModel ?? "",
      temperature: payload.ai?.temperature ?? 1,
      maxTokens: payload.ai?.maxTokens ?? 128_000,
    },
    branding: payload.branding,
  });
}
```

- [ ] **Step 2: Update the save input schema + handler**

Replace `saveAppSettingsInputSchema`'s `dataforseo` field (lines 132-157):

```ts
const saveAppSettingsInputSchema = z.object({
  expectedUpdatedAt: z.string().nullable().optional(),
  dataforseo: z.union([
    z.object({
      credentials: z
        .array(
          z.object({
            id: z.string().min(1).max(64),
            login: z.string().max(255).optional().default(""),
            password: z.string().max(1024).optional().default(""),
          }),
        )
        .max(10),
    }),
    // Legacy single-pair payloads still save.
    z.object({
      login: z.string().max(255).optional().default(""),
      password: z.string().max(1024).optional().default(""),
    }),
  ]),
  ai: z.object({
    openrouterApiKey: z.string().max(1024).optional().default(""),
    openaiApiKey: z.string().max(1024).optional().default(""),
    anthropicApiKey: z.string().max(1024).optional().default(""),
    defaultModel: z.string().max(255).optional().default(""),
    temperature: z.number().min(0).max(2).optional().default(1),
    maxTokens: z
      .number()
      .int()
      .min(64)
      .max(128_000)
      .optional()
      .default(128_000),
  }),
  branding: z.object({
    appTitle: z.string().min(1).max(100).default("AbbaSeo"),
    defaultRegion: z.string().max(10).default("US"),
    currency: z.string().max(10).default("USD"),
  }),
});
```

In the `saveAppSettings` handler (lines 159-175), add selector-cache invalidation after a successful save:

```ts
export const saveAppSettings = createServerFn({ method: "POST" })
  .middleware(requireSettingsAdminContext)
  .validator(saveAppSettingsInputSchema)
  .handler(async ({ data: input }) => {
    const current = await loadAppSettingsSnapshot({ fresh: true });
    const payload = mergeAppSettingsSecrets(
      current.payload,
      appSettingsPayloadSchema.parse(input),
    );
    const saved = await saveAppSettingsPayload(
      payload,
      input.expectedUpdatedAt === undefined
        ? current.updatedAt
        : input.expectedUpdatedAt,
    );
    // New credentials must be probed fresh — old balance snapshots are stale.
    dataforseoCredentialSelector.invalidateCache();
    return redact(saved.payload, saved.updatedAt);
  });
```

- [ ] **Step 3: Rewrite `getDataforseoUsage`**

Replace `getDataforseoUsage` (lines 309-340):

```ts
// Live per-credential usage & balance, probed from DataForSEO's free
// user_data endpoint for every configured credential (settings list first,
// env var last). Returns account numbers per credential so the UI can show
// which account will serve requests and which are exhausted.
export const getDataforseoUsage = createServerFn({ method: "GET" })
  .middleware(requireSettingsAdminContext)
  .handler(async () => {
    const credentials = await loadConfiguredDataforseoCredentials();
    if (credentials.length === 0) {
      throw new AppError(
        "VALIDATION_ERROR",
        "DataForSEO credentials are not configured. Save them in Settings first.",
      );
    }

    const rows = await Promise.all(
      credentials.map(async (credential) => {
        const { account, invalid } = await probeUserDataAccount(
          credential.encoded,
        );
        return {
          id: credential.id,
          login: account?.login ?? credential.login,
          fromEnv: credential.fromEnv,
          invalid,
          balance: account?.balance ?? null,
          total: account?.total ?? null,
          daySpend: account?.daySpend ?? null,
          minuteSpend: account?.minuteSpend ?? null,
        };
      }),
    );

    const { getAppSettingsQueryCount } =
      await import("@/server/features/settings/SettingsRepository");
    return {
      credentials: rows,
      queriesUsed: await getAppSettingsQueryCount(),
    };
  });
```

Remove the now-unused `getDynamicRequiredEnvValue` from the SettingsService import block (it was only used by `getDataforseoUsage` and `testDataforseoConnection` never used it). If typecheck complains later, adjust the import list.

- [ ] **Step 4: Append validator tests**

Append to `src/serverFunctions/settings.test.ts`:

```ts
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
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm vitest run src/serverFunctions/settings.test.ts`
Expected: PASS — 6 tests.

Run: `pnpm types:check`
Expected: clean (some import adjustments may be needed; fix them).

- [ ] **Step 6: Commit**

```bash
git add src/serverFunctions/settings.ts src/serverFunctions/settings.test.ts
git commit -m "feat(settings): multi-credential save, redact, and usage server functions"
```

---

### Task 7: Observability — `getDataforseoBalance` sums across credentials

**Files:**
- Modify: `src/serverFunctions/observability.ts:27-42`

**Interfaces:**
- Consumes: Task 4 `dataforseoCredentialSelector`, Task 1 `probeUserDataAccount`.
- Produces: `getDataforseoBalance` returns `{ balance, total, daySpend, minuteSpend, credentials } | null` where the four numbers are summed across all credentials (empty-list/zero when nothing readable — matches previous null-mapping semantics for the StatusBar), plus per-credential rows. StatusBar renders `balance` = total wallet across accounts.

- [ ] **Step 1: Rewrite the balance handler**

Add to the imports of `src/serverFunctions/observability.ts` (keep existing):

```ts
import { dataforseoCredentialSelector } from "@/server/lib/dataforseo/credential-selector";
import { probeUserDataAccount } from "@/server/lib/dataforseo/user-data";
```

Replace `getDataforseoBalance` (lines 22-42):

```ts
/**
 * Live wallet balance across ALL configured DataForSEO credentials (settings
 * list first, env var last), summed for the status-bar ticker. Free
 * user_data probes, never billable; null when nothing is configured or the
 * account is unreachable. Also returns the per-credential breakdown so UI
 * can flag which accounts are exhausted.
 */
export const getDataforseoBalance = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(async () => {
    try {
      const credentials =
        await dataforseoCredentialSelector.listResolvedCredentials();
      if (credentials.length === 0) return null;

      const rows = await Promise.all(
        credentials.map(async (credential) => {
          const { account, invalid } = await probeUserDataAccount(
            credential.encoded,
          );
          return {
            id: credential.id,
            login: account?.login ?? credential.login,
            fromEnv: credential.fromEnv,
            invalid,
            balance: account?.balance ?? null,
            total: account?.total ?? null,
            daySpend: account?.daySpend ?? null,
            minuteSpend: account?.minuteSpend ?? null,
          };
        }),
      );

      const readable = rows.filter(
        (row) => row.balance !== null && !row.invalid,
      );
      const sum = (key: "balance" | "total" | "daySpend" | "minuteSpend") =>
        readable.reduce((total, row) => total + (row[key] ?? 0), 0);
      return {
        balance: sum("balance"),
        total: sum("total"),
        daySpend: sum("daySpend"),
        minuteSpend: sum("minuteSpend"),
        credentials: rows,
      };
    } catch {
      return null;
    }
  });
```

- [ ] **Step 2: Typecheck**

Run: `pnpm types:check`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/serverFunctions/observability.ts
git commit -m "feat(observability): sum DataForSEO balance across all credentials"
```

---

### Task 8: Client types + settings route wiring

**Files:**
- Modify: `src/client/features/settings/settingsTypes.ts`
- Modify: `src/routes/_app/settings.tsx`

**Interfaces:**
- Consumes: Task 6 public schema shape.
- Produces: `FormSettingsState["dataforseo"] = { credentials: Array<{id, login, password}> }` (`FormDataforseoSettings`); route prefill maps redacted `{id, login}` rows to form rows with blank passwords; post-save mapping same.
- Consumed by: Task 9 (`DataforseoTab`).

- [ ] **Step 1: Update form types**

Replace `src/client/features/settings/settingsTypes.ts`:

```ts
// Client-side settings form state. Secrets start blank and are only written
// to the server; the redacted public payload pre-fills the non-secret fields.
export type FormDataforseoSettings = {
  credentials: Array<{ id: string; login: string; password: string }>;
};

export type FormSettingsState = {
  dataforseo: FormDataforseoSettings;
  ai: {
    openrouterApiKey: string;
    openaiApiKey: string;
    anthropicApiKey: string;
    defaultModel: string;
    temperature: number;
    maxTokens: number;
  };
  branding: {
    appTitle: string;
    defaultRegion: string;
    currency: string;
  };
};

export const DEFAULT_FORM: FormSettingsState = {
  dataforseo: { credentials: [] },
  ai: {
    openrouterApiKey: "",
    openaiApiKey: "",
    anthropicApiKey: "",
    defaultModel: "",
    temperature: 1,
    maxTokens: 4096,
  },
  branding: {
    appTitle: "AbbaSeo",
    defaultRegion: "US",
    currency: "USD",
  },
};
```

- [ ] **Step 2: Update the route**

In `src/routes/_app/settings.tsx`, replace the `getAppSettings().then` prefill (lines 53-68) `dataforseo` field:

```ts
      .then((settings) => {
        if (cancelled) return;
        setPublicSettings(settings);
        setForm((f) => ({
          ...f,
          dataforseo: {
            credentials: settings.dataforseo.credentials.map(
              (credential) => ({
                id: credential.id,
                login: credential.login,
                password: "",
              }),
            ),
          },
          ai: {
            ...f.ai,
            defaultModel: settings.ai.defaultModel,
            temperature: settings.ai.temperature,
            maxTokens: settings.ai.maxTokens,
          },
          branding: settings.branding,
        }));
      })
```

In `saveAll`'s post-save `setForm` (lines 113-126), replace the `dataforseo` field:

```ts
      setForm((current) => ({
        ...current,
        dataforseo: {
          credentials: saved.dataforseo.credentials.map((credential) => ({
            id: credential.id,
            login: credential.login,
            password: "",
          })),
        },
        ai: {
          ...current.ai,
          defaultModel: saved.ai.defaultModel,
          temperature: saved.ai.temperature,
          maxTokens: saved.ai.maxTokens,
        },
        branding: saved.branding,
      }));
```

Also pass the new prop into `DataforseoTab` (lines 208-217):

```tsx
            {tab === "dataforseo" ? (
              <DataforseoTab
                configured={publicSettings?.dataforseo.configured ?? false}
                envConfigured={publicSettings?.dataforseo.envConfigured ?? false}
                form={form.dataforseo}
                setDataforseo={setDataforseo}
                isSaving={isSaving}
                refreshToken={usageRefreshToken}
                onSave={() => void saveAll()}
              />
            ) : null}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm types:check`
Expected: FAIL — `DataforseoTab` doesn't accept `envConfigured` yet (fixed in Task 9). This is expected mid-plan; proceed to Task 9.

- [ ] **Step 4: Commit**

```bash
git add src/client/features/settings/settingsTypes.ts src/routes/_app/settings.tsx
git commit -m "feat(settings): multi-credential form types and route wiring"
```

---

### Task 9: The list-builder UI + per-credential usage table (`DataforseoTab.tsx`)

**Files:**
- Modify: `src/client/features/settings/DataforseoTab.tsx`

**Interfaces:**
- Consumes: Task 8 `FormDataforseoSettings`, `envConfigured` prop; Task 6 server functions.
- Produces: credential rows (login + password + test + reorder + remove), "Add Credential" (cap 10), read-only env row when `envConfigured`, usage table per credential.
- Consumed by: route (no further consumers).

- [ ] **Step 1: Rewrite the credentials card + usage card**

Replace the whole `DataforseoTab.tsx` with:

```tsx
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  SectionCard,
  SecretField,
} from "@/client/features/settings/SettingsUi";
import type { FormDataforseoSettings } from "@/client/features/settings/settingsTypes";
import {
  getDataforseoUsage,
  testDataforseoConnection,
} from "@/serverFunctions/settings";
import { toast } from "sonner";

const MAX_CREDENTIALS = 10;

type TestResult = { ok: boolean; message: string } | undefined;

function createCredentialId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `cred-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function DataforseoTab(props: {
  configured: boolean;
  envConfigured: boolean;
  form: FormDataforseoSettings;
  setDataforseo: (patch: Partial<FormDataforseoSettings>) => void;
  isSaving: boolean;
  refreshToken: number;
  onSave: () => void;
}) {
  const {
    configured,
    envConfigured,
    form,
    setDataforseo,
    isSaving,
    refreshToken,
    onSave,
  } = props;
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>(
    {},
  );

  function addCredential() {
    if (form.credentials.length >= MAX_CREDENTIALS) {
      toast.error(
        `You can save up to ${MAX_CREDENTIALS} DataForSEO credentials.`,
      );
      return;
    }
    const id = createCredentialId();
    setDataforseo({
      credentials: [...form.credentials, { id, login: "", password: "" }],
    });
  }

  function updateCredential(
    id: string,
    patch: Partial<{ login: string; password: string }>,
  ) {
    setDataforseo({
      credentials: form.credentials.map((credential) =>
        credential.id === id ? { ...credential, ...patch } : credential,
      ),
    });
  }

  function removeCredential(id: string) {
    setDataforseo({
      credentials: form.credentials.filter(
        (credential) => credential.id !== id,
      ),
    });
  }

  function moveCredential(id: string, direction: -1 | 1) {
    const index = form.credentials.findIndex(
      (credential) => credential.id === id,
    );
    const target = index + direction;
    if (index < 0 || target < 0 || target >= form.credentials.length) return;
    const next = [...form.credentials];
    [next[index], next[target]] = [next[target], next[index]];
    setDataforseo({ credentials: next });
  }

  async function handleTest(id: string) {
    const credential = form.credentials.find((entry) => entry.id === id);
    if (!credential || !credential.login || !credential.password) {
      toast.error("Enter both a login and password to test.");
      return;
    }
    setTestingId(id);
    setTestResults((results) => ({ ...results, [id]: undefined }));
    try {
      const result = await testDataforseoConnection({
        data: { login: credential.login, password: credential.password },
      });
      setTestResults((results) => ({
        ...results,
        [id]: result.ok
          ? {
              ok: true,
              message:
                result.balance != null
                  ? `Connection successful. Account balance: $${result.balance.toFixed(2)}`
                  : "Connection successful.",
            }
          : { ok: false, message: result.message },
      }));
    } catch {
      setTestResults((results) => ({
        ...results,
        [id]: { ok: false, message: "Could not run the connection test." },
      }));
    } finally {
      setTestingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <SectionCard
        title="DataForSEO API Credentials"
        description="The app runs keyword, SERP, backlink, and audit queries through your DataForSEO accounts. Each request uses the account with the most remaining topup; when an account hits zero the next is used automatically."
      >
        <div className="space-y-3">
          {form.credentials.map((credential, index) => (
            <div
              key={credential.id}
              className="space-y-2 rounded-box border border-base-300 bg-base-100 p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-base-content/50">
                  {index === 0 ? "Primary account" : `Fallback ${index + 1}`}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="btn btn-ghost btn-square btn-xs"
                    disabled={index === 0}
                    onClick={() => moveCredential(credential.id, -1)}
                    aria-label="Move up"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-square btn-xs"
                    disabled={index === form.credentials.length - 1}
                    onClick={() => moveCredential(credential.id, 1)}
                    aria-label="Move down"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-square btn-xs text-error"
                    onClick={() => removeCredential(credential.id)}
                    aria-label="Remove credential"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium">
                  DataForSEO Login / Username
                </span>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={credential.login}
                  onChange={(event) =>
                    updateCredential(credential.id, {
                      login: event.currentTarget.value,
                    })
                  }
                  placeholder={
                    credential.login || credential.password
                      ? "Saved - edit to change"
                      : "DataForSEO login"
                  }
                  autoComplete="username"
                  spellCheck={false}
                />
              </label>
              <SecretField
                label="DataForSEO Password / API Key"
                value={credential.password}
                onChange={(value) =>
                  updateCredential(credential.id, { password: value })
                }
                placeholder={
                  credential.login || credential.password
                    ? "Saved - enter to change"
                    : "DataForSEO password"
                }
                revealed={revealed[credential.id] ?? false}
                onToggleReveal={() =>
                  setRevealed((current) => ({
                    ...current,
                    [credential.id]: !(current[credential.id] ?? false),
                  }))
                }
              />

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={testingId !== null}
                  onClick={() => void handleTest(credential.id)}
                >
                  {testingId === credential.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  Test Connection
                </button>
              </div>

              {testResults[credential.id] ? (
                <TestResultBanner result={testResults[credential.id]} />
              ) : null}
            </div>
          ))}
        </div>

        {envConfigured ? (
          <div className="flex items-center gap-2 rounded-box border border-base-300 bg-base-100 px-3 py-2 text-sm text-base-content/60">
            <span className="size-2 rounded-full bg-base-content/30" />
            <span>
              Environment variable key is configured and will be used as the
              last fallback account.
            </span>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={form.credentials.length >= MAX_CREDENTIALS}
            onClick={addCredential}
          >
            <Plus className="size-4" />
            Add Credential ({form.credentials.length}/{MAX_CREDENTIALS})
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={isSaving}
            onClick={onSave}
          >
            Save Credentials
          </button>
        </div>
      </SectionCard>

      <UsageCard configured={configured} refreshToken={refreshToken} />
    </div>
  );
}

export function TestResultBanner({
  result,
}: {
  result: NonNullable<TestResult>;
}) {
  return (
    <div
      role="status"
      className={`flex items-start gap-2 rounded-box border p-3 text-sm ${
        result.ok
          ? "border-success/30 bg-success/10 text-success"
          : "border-error/30 bg-error/10 text-error"
      }`}
    >
      {result.ok ? (
        <Check className="mt-0.5 size-4 shrink-0" />
      ) : (
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
      )}
      {result.message}
    </div>
  );
}

type UsageRow = {
  id: string;
  login: string;
  fromEnv: boolean;
  invalid: boolean;
  balance: number | null;
  total: number | null;
  daySpend: number | null;
  minuteSpend: number | null;
};

type Usage = {
  credentials: UsageRow[];
  queriesUsed: number;
};

function UsageCard({
  configured,
  refreshToken,
}: {
  configured: boolean;
  refreshToken: number;
}) {
  const [usage, setUsage] = useState<Usage | undefined>(undefined);
  const [status, setStatus] = useState<
    "loading" | "loaded" | "error" | "empty"
  >("loading");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      setUsage(await getDataforseoUsage());
      setStatus("loaded");
    } catch {
      setStatus(configured ? "error" : "empty");
    }
  }, [configured]);

  useEffect(() => {
    if (!configured) {
      setStatus("empty");
      return;
    }
    void load();
  }, [configured, load, refreshToken]);

  return (
    <SectionCard
      title="API Usage & Balance"
      description="Live account numbers from DataForSEO's free usage endpoint, one row per credential."
    >
      {status === "loading" ? (
        <div className="flex items-center gap-2 py-4 text-sm text-base-content/50">
          <Loader2 className="size-4 animate-spin" />
          Fetching account usage…
        </div>
      ) : null}

      {status === "empty" ? (
        <p className="py-2 text-sm text-base-content/60">
          Save DataForSEO credentials above to see your live balance and usage.
        </p>
      ) : null}

      {status === "error" ? (
        <p className="flex items-center gap-2 py-2 text-sm text-error">
          <CircleAlert className="size-4" />
          Could not fetch usage. Refresh or re-test your credentials.
        </p>
      ) : null}

      {status === "loaded" && usage ? (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr className="text-xs text-base-content/50">
                  <th>Account</th>
                  <th>Source</th>
                  <th>Balance</th>
                  <th>Deposited (lifetime)</th>
                  <th>Spend (24h)</th>
                </tr>
              </thead>
              <tbody>
                {usage.credentials.map((credential) => (
                  <tr key={credential.id}>
                    <td className="font-medium">{credential.login || "—"}</td>
                    <td className="text-xs text-base-content/50">
                      {credential.invalid ? (
                        <span className="text-error">invalid key</span>
                      ) : credential.fromEnv ? (
                        "environment"
                      ) : (
                        "settings"
                      )}
                    </td>
                    <td
                      className={`font-semibold tabular-nums ${
                        !credential.invalid &&
                        credential.balance !== null &&
                        credential.balance <= 0
                          ? "text-error"
                          : "text-primary"
                      }`}
                    >
                      {credential.invalid || credential.balance === null
                        ? "—"
                        : `$${credential.balance.toFixed(2)}`}
                    </td>
                    <td className="tabular-nums">
                      {credential.total === null
                        ? "—"
                        : `$${credential.total.toFixed(2)}`}
                    </td>
                    <td className="tabular-nums">
                      {credential.daySpend === null
                        ? "—"
                        : `$${credential.daySpend.toFixed(2)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-base-content/60">
            Queries used:{" "}
            <span className="font-semibold text-base-content">
              {usage.queriesUsed.toLocaleString()}
            </span>
          </p>
        </div>
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={status === "loading"}
          onClick={() => void load()}
        >
          <RefreshCw
            className={`size-3.5 ${status === "loading" ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>
    </SectionCard>
  );
}
```

Note: the old `Stat` component and `Usage` type are fully replaced above.

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm types:check`
Expected: clean (resolves the expected Task 8 failure).

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 3: Run the full unit suite**

Run: `pnpm vitest run`
Expected: PASS — all existing + new tests.

- [ ] **Step 4: Commit**

```bash
git add src/client/features/settings/DataforseoTab.tsx
git commit -m "feat(settings): DataForSEO credential list builder and per-account usage table"
```

---

### Task 10: Full verification and wrap-up

**Files:**
- Verify only; edit `docs/DATAFORSEO_API_KEY.md` if present.

- [ ] **Step 1: Run the full test suite**

Run: `pnpm vitest run`
Expected: PASS — all test files.

- [ ] **Step 2: Typecheck**

Run: `pnpm types:check`
Expected: clean.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 4: Sanity-probe the running app (auth-mode local_noauth)**

With the dev server running on `http://localhost:3001`:

1. Open the DataForSEO settings tab, add 2-3 credentials, save, confirm the per-credential usage table renders balances.
2. Confirm the status-bar wallet pill shows the summed balance.

- [ ] **Step 5: Update docs**

Append to `docs/DATAFORSEO_API_KEY.md`:

```markdown
## Multiple credentials & automatic fallback

The Settings screen accepts up to 10 DataForSEO credentials. The app probes
each account's balance (free `user_data` endpoint, 60-second cache) and routes
billable requests to the account with the most remaining topup, switching to
the next account as each one hits zero. The `DATAFORSEO_API_KEY` environment
variable, when set, acts as an additional final fallback account. When every
account is exhausted the request still goes out with the primary key so
DataForSEO's own error surfaces to the user.
```

- [ ] **Step 6: Commit docs**

```bash
git add docs/DATAFORSEO_API_KEY.md
git commit -m "docs: document multi-credential DataForSEO fallback"
```