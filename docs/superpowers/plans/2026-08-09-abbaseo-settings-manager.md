# AbbaSeo Rebrand and Settings Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the existing partial work so the application is branded `AbbaSeo` and provides a secure deployment-wide `/settings` manager for DataForSEO, AI providers, branding, and preferences.

**Architecture:** Store one validated, encrypted deployment-wide settings payload in the existing `app_settings` table. Authenticated TanStack server functions return redacted settings and perform provider tests; runtime DataForSEO/OpenRouter resolution checks the settings store before the existing environment variables. The current tabbed React UI is retained and repaired rather than replaced.

**Tech Stack:** React 19, TanStack Start/Router server functions, TanStack Query, Drizzle ORM for SQLite/D1 and Postgres, Better Auth symmetric crypto, Zod, DaisyUI/Tailwind, Lucide, Vitest, Vite, pnpm.

## Global Constraints

- Settings are deployment-wide, not user- or organization-scoped.
- Secrets are encrypted at rest when `BETTER_AUTH_SECRET` is configured and never returned to the browser.
- Empty secret inputs preserve an already-configured stored value; explicit secret deletion is outside this screen's scope.
- Settings values override environment variables immediately; environment variables remain the fallback.
- All settings server functions require the existing authenticated context and validate untrusted input with Zod.
- Preserve internal environment names, package identifiers, operational domains, and historical URLs; only user-facing branding changes to `AbbaSeo`.
- Do not commit changes unless the user explicitly requests a commit.
- Use the existing application UI patterns and integrate a compatible component found through `npx @21st-dev/cli` before adding new custom UI primitives.

---

## File Map

### Existing settings and persistence code to repair

- Modify `src/server/features/settings/appSettingsSchema.ts`: keep the persisted payload and public redaction contracts strict.
- Modify `src/server/features/settings/SettingsService.ts`: merge blank secret inputs safely, preserve env fallback, and expose testable runtime-resolution helpers.
- Modify `src/server/features/settings/SettingsRepository.ts`: add atomic deployment-wide DataForSEO query-count access.
- Modify `src/serverFunctions/settings.ts`: normalize redacted status, preserve existing secrets during save, include live usage/query count, and keep provider tests non-persisting.
- Modify `src/serverFunctions/config.ts`, `src/serverFunctions/observability.ts`, and `src/serverFunctions/samAccess.ts`: use dynamic settings-aware provider status.

### Database and provider wiring

- Modify `src/db/app.schema.ts`, `src/db/pg/app.schema.ts`, and `src/db/schema.ts`: add a deployment-wide query counter to `app_settings` without changing the table's single-row identity.
- Create the next SQLite migration under `drizzle/` and the next Postgres migration under `drizzle-pg/` through Drizzle generation; update their journals/snapshots through the repository's existing migration command.
- Modify `src/server/lib/dataforseo/core.ts`: increment the counter from successful provider responses while excluding the free account-usage endpoint.
- Modify `src/server/lib/dataforseo/appendix.ts`: retain the free account usage read and its existing response typing.
- Modify `src/server/lib/openrouter.ts` and `src/server/features/sam/SamChatAgent.ts`: verify all new turns resolve the dynamic key/model without a restart.

### Client UI

- Modify `src/routes/_app/settings.tsx`: load, save, and refresh redacted settings safely.
- Modify `src/client/features/settings/settingsTypes.ts`, `SettingsUi.tsx`, `DataforseoTab.tsx`, `AiTab.tsx`, and `GeneralTab.tsx`: finish the responsive high-density cards, secret-field behavior, provider tests, sliders, and live usage display.
- Modify `src/client/components/Sidebar.tsx` and `src/client/layout/AppShell.tsx`: retain/verify the `/settings` navigation and `AbbaSeo` shell branding.

### Tests and rebrand verification

- Create `src/server/features/settings/appSettingsSchema.test.ts` for schema defaults and redaction shape.
- Create `src/server/features/settings/SettingsService.test.ts` for secret merging, encryption fallback boundaries, and settings-over-env precedence.
- Create `src/server/lib/dataforseo/core.test.ts` for dynamic auth and query-count behavior with mocked fetch/repository calls.
- Create `src/server/lib/openrouter.test.ts` for dynamic key/model resolution and model construction.
- Modify `src/db/schema-parity.test.ts` if the new column requires an explicit parity fixture.
- Audit user-facing matches in `src/routes/__root.tsx`, `src/client/components/Sidebar.tsx`, `src/client/layout/AppShell.tsx`, `web/src/lib/seo.ts`, `web/src/components/site-footer.tsx`, `public/site.webmanifest`, and `web/public/site.webmanifest`; use repository-wide search to find any additional user-facing matches.

---

### Task 1: Lock Down Settings Payload and Secret Semantics

**Files:**

- Modify: `src/server/features/settings/appSettingsSchema.ts`
- Modify: `src/server/features/settings/SettingsService.ts`
- Modify: `src/serverFunctions/settings.ts`
- Create: `src/server/features/settings/appSettingsSchema.test.ts`
- Create: `src/server/features/settings/SettingsService.test.ts`

**Interfaces:**

- `appSettingsPayloadSchema` continues to produce `AppSettingsPayload` with DataForSEO, AI, and branding groups.
- Add a pure exported helper `mergeAppSettingsSecrets(current: AppSettingsPayload, input: AppSettingsPayload): AppSettingsPayload` that preserves a current secret when the incoming secret field is empty.
- `getDynamicSecretValue(name)` returns only a stored settings value or `undefined`; `getDynamicRequiredEnvValue(name)` keeps settings-first/env-second behavior.

- [ ] **Step 1: Write failing schema tests**

```ts
import { describe, expect, it } from "vitest";
import {
  appSettingsPayloadSchema,
  publicAppSettingsSchema,
} from "@/server/features/settings/appSettingsSchema";

const payload = {
  dataforseo: { login: "login", password: "secret" },
  ai: {
    openrouterApiKey: "or-key",
    openaiApiKey: "oa-key",
    anthropicApiKey: "ant-key",
    defaultModel: "openai/gpt-4o",
    temperature: 0.7,
    maxTokens: 4096,
  },
  branding: { appTitle: "AbbaSeo", defaultRegion: "US", currency: "USD" },
};

describe("app settings schemas", () => {
  it("accepts the complete deployment payload", () => {
    expect(appSettingsPayloadSchema.parse(payload)).toEqual(payload);
  });

  it("rejects an out-of-range temperature", () => {
    expect(() =>
      appSettingsPayloadSchema.parse({
        ...payload,
        ai: { ...payload.ai, temperature: 2.1 },
      }),
    ).toThrow();
  });

  it("does not allow secret fields in the public response", () => {
    const result = publicAppSettingsSchema.parse({
      dataforseo: { configured: true, login: "login" },
      ai: {
        openrouterConfigured: true,
        openaiConfigured: false,
        anthropicConfigured: false,
        defaultModel: "openai/gpt-4o",
        temperature: 0.7,
        maxTokens: 4096,
      },
      branding: payload.branding,
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("or-key");
  });
});
```

- [ ] **Step 2: Run the focused schema test and verify it fails for the missing contract**

Run: `pnpm vitest run src/server/features/settings/appSettingsSchema.test.ts`

Expected: the test command starts and fails only if the current schema contract does not expose the expected parsing/redaction behavior; no unrelated test files should run.

- [ ] **Step 3: Add the pure secret-merge helper and preserve stored values on save**

```ts
export function mergeAppSettingsSecrets(
  current: AppSettingsPayload,
  input: AppSettingsPayload,
): AppSettingsPayload {
  return {
    ...input,
    dataforseo: {
      ...input.dataforseo,
      login: input.dataforseo.login || current.dataforseo.login,
      password: input.dataforseo.password || current.dataforseo.password,
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
```

Use the helper in `saveAppSettings` after loading the current payload and before `saveAppSettingsPayload`. Keep the public response redacted and do not add masked secret values to it.

- [ ] **Step 4: Add service precedence tests**

```ts
import { describe, expect, it } from "vitest";
import { mergeAppSettingsSecrets } from "@/server/features/settings/SettingsService";

describe("mergeAppSettingsSecrets", () => {
  it("preserves configured secrets when another tab saves blank secret fields", () => {
    const current = {
      dataforseo: { login: "saved-login", password: "saved-password" },
      ai: {
        openrouterApiKey: "saved-or-key",
        openaiApiKey: "saved-oa-key",
        anthropicApiKey: "saved-ant-key",
        defaultModel: "openai/gpt-4o",
        temperature: 1,
        maxTokens: 4096,
      },
      branding: { appTitle: "AbbaSeo", defaultRegion: "US", currency: "USD" },
    };
    const input = {
      ...current,
      dataforseo: { login: "", password: "" },
      ai: {
        ...current.ai,
        openrouterApiKey: "",
        openaiApiKey: "",
        anthropicApiKey: "",
      },
      branding: { appTitle: "New title", defaultRegion: "UK", currency: "GBP" },
    };

    expect(mergeAppSettingsSecrets(current, input)).toMatchObject({
      dataforseo: current.dataforseo,
      ai: {
        ...current.ai,
        defaultModel: current.ai.defaultModel,
        temperature: current.ai.temperature,
        maxTokens: current.ai.maxTokens,
      },
      branding: input.branding,
    });
  });
});
```

- [ ] **Step 5: Run focused tests**

Run: `pnpm vitest run src/server/features/settings/appSettingsSchema.test.ts src/server/features/settings/SettingsService.test.ts`

Expected: PASS.

---

### Task 2: Add Persistent Query Usage and Dynamic Provider Resolution

**Files:**

- Modify: `src/db/app.schema.ts`
- Modify: `src/db/pg/app.schema.ts`
- Modify: `src/server/features/settings/SettingsRepository.ts`
- Modify: `src/server/lib/dataforseo/core.ts`
- Modify: `src/serverFunctions/settings.ts`
- Modify: `src/serverFunctions/config.ts`
- Modify: `src/serverFunctions/observability.ts`
- Modify: `src/serverFunctions/samAccess.ts`
- Modify: `src/server/lib/openrouter.ts`
- Modify: `src/server/features/sam/SamChatAgent.ts`
- Create: `src/server/features/settings/SettingsRepository.test.ts`
- Create: `src/server/lib/dataforseo/core.test.ts`
- Create: `src/server/lib/openrouter.test.ts`

**Interfaces:**

- Add `queryCount: number` to both dialects' `app_settings` table, defaulting to `0`.
- Add `getAppSettingsQueryCount(): Promise<number>` and `incrementAppSettingsQueryCount(delta: number): Promise<void>` to `SettingsRepository`.
- `getDataforseoUsage()` returns `{ login, balance, total, daySpend, minuteSpend, queriesUsed }`.
- Successful non-`/v3/appendix/user_data` DataForSEO responses increment the counter by `tasks_count` when present, otherwise by `1`; counter failures never fail a provider request.

- [ ] **Step 1: Extend both schema definitions and generate migrations**

Add the same column to both dialects:

```ts
queryCount: integer("query_count").notNull().default(0),
```

Run: `pnpm db:generate`

Expected: one new SQLite migration and one new Postgres migration containing an integer `query_count` column on `app_settings`; existing migration journals/snapshots update without changing unrelated tables.

- [ ] **Step 2: Write the failing repository contract test**

Add a test seam around the repository's DB dependency and assert that an increment uses an atomic SQL expression rather than reading and writing a stale count:

```ts
it("increments the deployment-wide query count atomically", async () => {
  await incrementAppSettingsQueryCount(3);
  expect(mockUpdateSet).toHaveBeenCalledWith(
    expect.objectContaining({ queryCount: expect.anything() }),
  );
});
```

Run: `pnpm vitest run src/server/features/settings/SettingsRepository.test.ts`

Expected: FAIL until the repository function exists. If the current repository test harness cannot isolate Drizzle, keep the same assertion in `src/server/lib/dataforseo/core.test.ts` with a mocked repository module.

- [ ] **Step 3: Implement repository count access**

Use a dialect-neutral update expression and swallow only the "no settings row yet" case by inserting the normal empty settings row before the increment. The update must look like:

```ts
await db
  .update(appSettings)
  .set({
    queryCount: sql`${appSettings.queryCount} + ${delta}`,
    updatedAt: new Date().toISOString(),
  })
  .where(eq(appSettings.id, APP_SETTINGS_ID));
```

Validate `delta` as a positive integer before reaching the repository.

- [ ] **Step 4: Count successful provider task responses**

In `createAuthenticatedFetch`, after a successful response and before returning it:

```ts
const path = formatDataforseoRequestPath(url);
if (path !== "/v3/appendix/user_data") {
  void recordDataforseoQueryCount(response.clone());
}
```

`recordDataforseoQueryCount` must parse only `tasks_count`, use `Math.max(1, tasksCount)` when it is finite, call `incrementAppSettingsQueryCount`, and catch all parsing/storage errors so the original provider response remains successful.

- [ ] **Step 5: Wire settings-aware status and usage reads**

Make `getDataforseoUsage` use the settings-first/env-fallback resolver instead of requiring a stored row. Return `queriesUsed` from the repository. Change the setup banner, observability status, and SAM access status to use `getDynamicSecretValue` plus env fallback, so a key saved in Settings clears those states immediately.

- [ ] **Step 6: Verify dynamic AI resolution**

Keep `getChatAgentModel()` asynchronous and settings-first. Ensure SAM refreshes `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` before every request lifecycle. The synchronous `getModel()` must use the refreshed values and only fall back to the Durable Object env snapshot when the settings read is unavailable.

- [ ] **Step 7: Add provider wiring tests**

Test the fetch wrapper with a mocked successful response containing `tasks_count: 4`, assert the repository receives `4`, test that `/v3/appendix/user_data` is excluded, and test that repository rejection still returns the original response. Mock `createOpenRouter` and assert `getChatAgentModel()` passes the stored model/key before env values.

- [ ] **Step 8: Run focused provider tests**

Run: `pnpm vitest run src/server/lib/dataforseo/core.test.ts src/server/lib/openrouter.test.ts src/server/features/settings/SettingsService.test.ts`

Expected: PASS.

---

### Task 3: Finish the Settings Screen and Navigation

**Files:**

- Modify: `src/routes/_app/settings.tsx`
- Modify: `src/client/features/settings/settingsTypes.ts`
- Modify: `src/client/features/settings/SettingsUi.tsx`
- Modify: `src/client/features/settings/DataforseoTab.tsx`
- Modify: `src/client/features/settings/AiTab.tsx`
- Modify: `src/client/features/settings/GeneralTab.tsx`
- Modify: `src/client/components/Sidebar.tsx`
- Modify: `src/client/layout/AppShell.tsx`

**Interfaces:**

- Keep the existing `FormSettingsState` shape and redacted `PublicAppSettings` contract.
- Each tab owns local provider-test state but delegates one save callback to the route.
- Secret inputs stay blank after load when configured; their placeholders say `Saved - enter to change`.

- [ ] **Step 1: Search 21st.dev before adding UI primitives**

Run the authenticated registry search before writing new custom controls:

```bash
API_KEY_21ST="$API_KEY_21ST" npx @21st-dev/cli search "settings page api key form tabs" --json
```

Expected: JSON component results. Select the smallest compatible field/card/tabs component, install it with the CLI's reported install command, and integrate it only where it does not conflict with the repository's DaisyUI classes. Keep existing project-native components when the registry result would add a second visual system.

- [ ] **Step 2: Fix secret-field semantics and accessibility**

Use one reveal button for the DataForSEO password only; the login is plain text. Keep independent reveal buttons for the three AI keys. Every reveal button must have an `aria-label`, every input must have a visible label, and buttons must disable while their request is pending.

- [ ] **Step 3: Make save responses refresh configured state**

After `saveAppSettings` resolves, update both `publicSettings` and the form's non-secret fields, invalidate/reload the usage card, and show `Settings saved. Changes apply immediately.`. A failed save must leave the edited form intact and show a generic toast without logging secrets.

- [ ] **Step 4: Render live DataForSEO usage**

Add a `Queries used` stat using `queriesUsed`, alongside balance and provider spend. Keep the card in an empty state when neither settings nor env credentials are configured, and add a refresh action that never exposes credentials in the request payload.

- [ ] **Step 5: Complete AI controls**

Render OpenRouter, OpenAI, and Anthropic fields; include the requested model values `anthropic/claude-3.5-sonnet`, `openai/gpt-4o`, and `google/gemini-flash`; constrain temperature to `0..2` and max tokens to `64..128000`; test only the entered OpenRouter key/model without saving it.

- [ ] **Step 6: Verify route/sidebar behavior**

Confirm the settings link remains in the authenticated sidebar footer, is active at `/settings`, works on mobile drawer navigation, and preserves project navigation context. Confirm the mobile top bar and sidebar logo read `AbbaSeo`.

- [ ] **Step 7: Run the typecheck after the UI task**

Run: `pnpm types:check`

Expected: PASS with no unused imports, route type errors, or server-function validator mismatches.

---

### Task 4: Complete the Rebrand Audit

**Files:**

- Modify: `src/routes/__root.tsx`
- Modify: `src/client/components/Sidebar.tsx`
- Modify: `src/client/layout/AppShell.tsx`
- Modify: `web/src/lib/seo.ts`
- Modify: `web/src/components/site-footer.tsx`
- Modify: `public/site.webmanifest`
- Modify: `web/public/site.webmanifest`
- Modify: any additional user-facing files returned by the search below
- Modify: `docs/superpowers/specs/2026-08-09-abbaseo-settings-manager-design.md` if the legacy name appears only as an explanatory label

- [ ] **Step 1: Enumerate exact legacy-name matches**

Run an exact-name repository search for the legacy product name, excluding `node_modules`.

Expected: no product source match after this task. The design document may use `legacy product name` instead of repeating the old string so the repository-wide assertion is unambiguous.

- [ ] **Step 2: Audit case-insensitive operational matches**

Run: `git grep -ni "openseo" -- . ':!node_modules'`

Classify each match before editing. Replace visible product copy, page titles, metadata, manifest names, headings, footer labels, logo text, and user-facing email copy. Keep internal package names, env vars such as `OPENSEO_TELEMETRY_DISABLED`, database/resource identifiers, deployed domains, URLs, and historical release references unless they are visibly rendered as the product name.

- [ ] **Step 3: Verify metadata and manifest values**

Ensure the root document title, Open Graph title, app manifest `name`/`short_name`, marketing SEO defaults, authenticated shell, sidebar, and footer use `AbbaSeo`.

- [ ] **Step 4: Run formatting validation**

Run: `pnpm prettier --check src/routes/__root.tsx src/client/components/Sidebar.tsx src/client/layout/AppShell.tsx web/src/lib/seo.ts web/src/components/site-footer.tsx public/site.webmanifest web/public/site.webmanifest docs/superpowers/specs/2026-08-09-abbaseo-settings-manager-design.md`

Expected: PASS.

---

### Task 5: Full Verification and Review Handoff

**Files:**

- Verify all files changed by Tasks 1-4.
- Modify only files required to fix failures found by the commands below.

- [ ] **Step 1: Run focused settings/provider tests**

Run: `pnpm vitest run src/server/features/settings/appSettingsSchema.test.ts src/server/features/settings/SettingsService.test.ts src/server/lib/dataforseo/core.test.ts src/server/lib/openrouter.test.ts`

Expected: PASS.

- [ ] **Step 2: Run the complete unit suite**

Run: `pnpm test`

Expected: PASS. If a failure is caused by an existing unrelated dirty-worktree change, record the exact failure and do not revert that change.

- [ ] **Step 3: Run lint and build checks**

Run: `pnpm lint`

Expected: PASS.

Run: `pnpm build`

Expected: Vite build and TypeScript emit check both PASS.

- [ ] **Step 4: Check generated migration and formatting integrity**

Run: `pnpm format:check`

Expected: PASS, including both dialect schemas and generated migrations.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 5: Review the final worktree without reverting unrelated work**

Run: `git status --short` and `git diff --stat`.

Confirm settings files, migration files, provider wiring, and branding changes are present. Leave unrelated pre-existing user changes untouched and report them separately.
