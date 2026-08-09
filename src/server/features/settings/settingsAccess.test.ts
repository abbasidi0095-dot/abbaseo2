import { describe, expect, it } from "vitest";
import { canManageDeploymentSettings } from "@/server/features/settings/settingsAccess";

describe("canManageDeploymentSettings", () => {
  it("allows the authenticated operator in self-hosted modes", () => {
    expect(
      canManageDeploymentSettings({
        authMode: "cloudflare_access",
        userEmail: "operator@example.com",
        role: "member",
      }),
    ).toBe(true);
  });

  it("allows hosted owners and admins", () => {
    expect(
      canManageDeploymentSettings({
        authMode: "hosted",
        userEmail: "owner@example.com",
        role: "owner",
      }),
    ).toBe(true);
    expect(
      canManageDeploymentSettings({
        authMode: "hosted",
        userEmail: "admin@example.com",
        role: "admin",
      }),
    ).toBe(true);
  });

  it("requires an explicit hosted admin identity for hosted members", () => {
    expect(
      canManageDeploymentSettings({
        authMode: "hosted",
        userEmail: "member@example.com",
        role: "member",
      }),
    ).toBe(false);
    expect(
      canManageDeploymentSettings({
        authMode: "hosted",
        userEmail: "Admin@Example.com",
        adminEmail: "admin@example.com",
        role: "member",
      }),
    ).toBe(true);
    expect(
      canManageDeploymentSettings({
        authMode: "hosted",
        userEmail: "owner@example.com",
        adminEmail: "admin@example.com",
        role: "owner",
      }),
    ).toBe(false);
  });
});
