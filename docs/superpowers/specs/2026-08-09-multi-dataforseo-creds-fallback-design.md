# Multi-Credential DataForSEO with Balance-Based Rotation

- **Status:** Accepted
- **Date:** 2026-08-09
- **Author:** opencode session
- **Related:** specs/0002-hosted-dataforseo-metering-with-autumn.md, src/server/lib/dataforseo/core.ts

## Problem

OpenSeo supports exactly one DataForSEO credential per deployment (settings-store
pair or `DATAFORSEO_API_KEY` env var). When that account's topup/balance hits zero,
all billable DataForSEO calls fail with a billing error until someone tops up.

Requirements:

1. Add multiple DataForSEO credentials at a time (list builder UI, up to 10).
2. When a credential's topup reaches 0, automatically fall back to the next
   credential — proactive balance checks (not reactive error classification).
3. Selection rule: highest available balance wins; attempt-anyway (primary key)
   only when every credential's balance is 0 or unknown.

## Design decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Fallback trigger | Proactive — balance probed via free `/v3/appendix/user_data` |
| Credential input UX | List builder (add/remove rows, reorder), cap 10 |
| Selection order | Highest balance first; ties → earlier in list; all-zero → attempt-anyway with primary |
| All-zero behavior | Attempt the call anyway with primary key; DataForSEO's own error surfaces |
| Balance cache freshness | 60s TTL per credential |
| Approach | Selector at the auth choke point (`createAuthenticatedFetch`, core.ts), covering all 26 call sites |

## Architecture

### 1. Storage & schema (backward compatible)

`src/server/features/settings/appSettingsSchema.ts` — payload shape changes:

```ts
// legacy (still valid input, migrated on read):
dataforseo: { login: string, password: string }
// new:
dataforseo: {
  credentials: Array<{ id: string, login: string, password: string }>  // max 10
}
```

- Table `app_settings` schema unchanged (credentials live inside the JSON payload).
- `SettingsService.getDynamicSecretValue` replaced by a credential-list resolver:
  settings list first, `DATAFORSEO_API_KEY` env appended as an implicit last entry
  when present.
- Env-only deployments keep working untouched (single implicit credential).

### 2. Selection logic — `DataforseoCredentialSelector`

New file: `src/server/lib/dataforseo/credential-selector.ts`.

- **resolve(): Promise<string>** — returns encoded `base64(login:password)` for the
  best credential.
- **Balance cache:** `Map<credId, { balance: number, checkedAt: number }>`, TTL 60s
  (matches the existing status-bar balance refetch cadence).
- **Free balance probe:** reuses `appendix.ts` `user_data` (already metering-exempt,
  core.ts:116). Probe fetches with an explicit key using raw fetch and **bypasses
  the selector itself** — no recursion.
- **Selection rule:**
  - Among creds with cached balance > 0 → pick highest balance; ties → earlier list
    position.
  - If all ≤ 0 or no cached balance yet → attempt-anyway with primary (settings[0],
    else env var).

### 3. Choke-point wiring

- `core.ts createAuthenticatedFetch` (lines 99-161): replace the single
  `getDynamicRequiredEnvValue("DATAFORSEO_API_KEY")` with
  `credentialSelector.resolve()`.
- **Recursion guard:** only the balance probe (user_data) bypasses the selector and
  uses an explicit key.
- All 26 metered call sites (MCP tools, services, workflows, rank-tracking) ride
  this path unchanged — zero changes in callers.

### 4. Error surface

- All-zero case → call proceeds with primary key; DataForSEO's own error response
  surfaces (unchanged behavior, incl. section classifiers where present).
- 401 during a balance probe marks that credential **invalid** → skipped in
  selection, surfaced as a row-level warning in the UI.

### 5. Settings UI (`DataforseoTab.tsx`)

- Credential card becomes a list builder:
  - Rows of login + SecretField password, up to 10.
  - "Add credential" button; remove per row; up/down reorder (affects tie-break /
    primary only).
  - Per-row "Test" → `testDataforseoConnection(login, password)` as today, showing
    that row's balance on success.
- Usage card (`UsageCard`): table of all credentials × balance, total deposited,
  24h spend, queries used — refreshed via existing `getDataforseoUsage`.
- `saveAppSettings` validator accepts both legacy and new shapes, normalizes to the
  new shape.
- Env var credential shows as a read-only "Environment variable" row when present.

### 6. Observability

- `StatusBar` wallet pill: sum of balances across writable credentials (env-only
  value when no settings list).
- `getDataforseoBalance` / `getDataforseoUsage` extended to return a per-credential
  breakdown.

## Non-goals

- Per-org / per-user credential storage — still deployment-wide only.
- Reactive billing-error fallback (classification widening) — replaced by the
  proactive selector.
- Credential-level query-count metering — `app_settings.query_count` stays global.

## Testing

- Selector unit tests: highest-balance pick; ties → list order; all-zero → primary;
  401 skip; TTL refresh; env-as-implicit; legacy payload migration.
- `core.test.ts`: resolver invoked for billing calls; balance probe bypasses the
  selector (no recursion).
- `settings.test.ts`: validator accepts legacy + new shapes; enforces cap of 10.