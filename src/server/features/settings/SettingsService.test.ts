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