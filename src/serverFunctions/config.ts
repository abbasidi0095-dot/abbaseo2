import { createServerFn } from "@tanstack/react-start";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import { isDynamicSecretConfigured } from "@/server/features/settings/SettingsService";

export const getSeoApiKeyStatus = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async () => {
    return {
      configured: await isDynamicSecretConfigured("DATAFORSEO_API_KEY"),
    };
  });
