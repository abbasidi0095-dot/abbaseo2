type SettingsAccessInput = {
  authMode: "hosted" | "cloudflare_access" | "local_noauth";
  userEmail: string;
  adminEmail?: string;
  role?: string | null;
};

export function canManageDeploymentSettings({
  authMode,
  userEmail,
  adminEmail,
  role,
}: SettingsAccessInput): boolean {
  if (authMode !== "hosted") return true;

  const normalizedUserEmail = userEmail.trim().toLowerCase();
  const normalizedAdminEmail = adminEmail?.trim().toLowerCase();
  if (normalizedAdminEmail) {
    return normalizedUserEmail === normalizedAdminEmail;
  }
  return role === "owner" || role === "admin";
}
