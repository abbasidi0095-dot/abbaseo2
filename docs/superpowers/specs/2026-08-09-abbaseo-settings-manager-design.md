# AbbaSeo Settings Manager

## Status

Approved design for the deployment-wide API key, provider, branding, and general settings work.

## Goals

- Replace the legacy user-facing product name with `AbbaSeo`.
- Add an authenticated `/settings` screen reachable from the main sidebar.
- Let a deployment administrator configure DataForSEO and AI provider credentials without restarting the server.
- Keep secrets server-side, encrypted at rest when `BETTER_AUTH_SECRET` is available, and redacted from client responses.
- Preserve existing environment-variable deployments as a fallback.

## Scope and Storage

Settings are deployment-wide, not user- or organization-scoped. A single `app_settings` row stores one validated JSON payload containing:

- DataForSEO login and password.
- OpenRouter, OpenAI, and Anthropic API keys.
- Default AI model, temperature, and max-token limit.
- Application title, target region, and currency.

The settings service encrypts the serialized payload with the existing Better Auth symmetric crypto helper when `BETTER_AUTH_SECRET` is configured. Trusted local/self-hosted deployments without that secret retain the existing plaintext tradeoff. A short server cache avoids repeated reads, and saves invalidate the cache immediately.

Environment variables remain the fallback when a corresponding settings value is empty. DataForSEO and OpenRouter clients resolve the dynamic value at request time, so a saved value applies to new requests without a process restart.

## UI

The protected `/settings` route uses the existing application shell and sidebar patterns. It renders three dense, responsive tabs:

### General

- Application Title, defaulting to `AbbaSeo`.
- Default target region/country, including US, UK, and FR.
- Currency preference, including USD and EUR.
- Existing appearance and hosted analytics preferences remain available in this tab.

### DataForSEO

- Login/username and password/API-key fields with reveal controls.
- Test Connection action that sends the entered credentials to DataForSEO's free `appendix/user_data` endpoint without persisting them.
- Save Credentials action.
- Live usage card showing account identity, current balance, provider usage totals, and available query-usage data from the account response or application request telemetry when the provider does not return a count.
- Safe success, validation, network, and provider-error states.

### AI & Models

- OpenRouter, OpenAI, and Anthropic key fields with independent reveal controls.
- Default model selector with the requested Claude, GPT-4o, and Gemini presets plus existing supported models.
- Temperature and max-token sliders.
- Test AI Prompt action using the entered OpenRouter key and selected model without persisting them.
- Save AI Settings action.

The browser receives only configured booleans for secret fields. Existing secrets are never sent back as masked or partially revealed values. On save, an empty secret field preserves an already-configured stored value; this prevents saving General preferences from accidentally clearing credentials. Explicit secret deletion is outside this screen's scope.

## Server API and Data Flow

TanStack server functions provide the route boundary:

- `getAppSettings`: authenticated read returning redacted settings.
- `saveAppSettings`: authenticated, Zod-validated write that persists and returns the redacted payload.
- `testDataforseoConnection`: authenticated, non-persisting provider test.
- `testAiConnection`: authenticated, non-persisting OpenRouter prompt test.
- `getDataforseoUsage`: authenticated live account usage read using the saved-or-env credentials.
- `getAiModelPresets`: authenticated model list for the selector.

Provider responses are normalized to small UI-safe objects. Provider failures are returned as non-throwing test results where possible; unexpected server/storage errors remain application errors and are shown through a generic toast.

## Security and Compatibility

- All settings functions require the existing authenticated context.
- Zod validates every untrusted input at the server boundary.
- Secret values are excluded from logs, client payloads, and error messages.
- Existing env names, package identifiers, operational domains, and historical documentation references stay unchanged unless they are user-facing branding.
- The existing DataForSEO setup banner must treat a saved settings credential as configured.

## Verification

- Typecheck and lint the full application.
- Run settings/server unit tests covering schema validation, encryption/decryption fallback, redaction, settings-over-env precedence, and provider test normalization.
- Run the existing test suite.
- Confirm the sidebar route, responsive form controls, reveal buttons, save actions, and test states render without exposing secrets.
- Verify both SQLite/D1 and Postgres schema migrations contain the new single-row table.
