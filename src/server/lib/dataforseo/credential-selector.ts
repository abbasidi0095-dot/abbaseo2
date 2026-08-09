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
    const decoded = atob(encodedKey);
    const separator = decoded.indexOf(":");
    return separator > 0 ? decoded.slice(0, separator) : "";
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