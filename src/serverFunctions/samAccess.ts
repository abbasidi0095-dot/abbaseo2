import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import { isDynamicSecretConfigured } from "@/server/features/settings/SettingsService";
import { requireProjectContext } from "@/serverFunctions/middleware";

const OPENROUTER_KEY_MISSING_MESSAGE =
  "OPENROUTER_API_KEY is not set for this deployment yet. Add it in Settings or your environment, then confirm here.";

const projectScopedSchema = z.object({ projectId: z.string().min(1) });

type SamAccessStatus = {
  enabled: boolean;
  errorMessage: string | null;
};

// Gates the in-app AI agent (SAM) on an OpenRouter key being configured, the
// same way backlinks/AI-search gate on their DataForSEO subscriptions. Hosted
// deployments always have the key provisioned, so only self-hosted is checked.
export const getSamAccessSetupStatus = createServerFn({ method: "GET" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async (): Promise<SamAccessStatus> => {
    if (await isHostedServerAuthMode()) {
      return { enabled: true, errorMessage: null };
    }

    const enabled = await isDynamicSecretConfigured("OPENROUTER_API_KEY");
    return {
      enabled,
      errorMessage: enabled ? null : OPENROUTER_KEY_MISSING_MESSAGE,
    };
  });
