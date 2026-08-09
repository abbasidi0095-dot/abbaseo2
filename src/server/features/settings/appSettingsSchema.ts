import { z } from "zod";

// Deployment-wide settings managed from the Settings screen. One payload per
// deployment, persisted as a single encrypted JSON row in `app_settings`.
// Empty strings mean "unset" (never stored as null so the UI round-trips).
export const dataforseoSettingsSchema = z.object({
  login: z.string().max(255),
  password: z.string().max(1024),
});

export const aiSettingsSchema = z.object({
  openrouterApiKey: z.string().max(1024),
  openaiApiKey: z.string().max(1024),
  anthropicApiKey: z.string().max(1024),
  defaultModel: z.string().max(255),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(64).max(128_000),
});

export const brandingSettingsSchema = z.object({
  appTitle: z.string().min(1).max(100),
  defaultRegion: z.string().max(10),
  currency: z.string().max(10),
});

export const appSettingsPayloadSchema = z.object({
  dataforseo: dataforseoSettingsSchema,
  ai: aiSettingsSchema,
  branding: brandingSettingsSchema,
});

export type AppSettingsPayload = z.infer<typeof appSettingsPayloadSchema>;
export type DataForSeoSettings = z.infer<typeof dataforseoSettingsSchema>;
export type AiSettings = z.infer<typeof aiSettingsSchema>;

export const DEFAULT_APP_SETTINGS_PAYLOAD: AppSettingsPayload = {
  dataforseo: { login: "", password: "" },
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

// What the client may see: secrets are replaced with boolean flags, and the
// branding/preferences are not sensitive. The DataForSEO login (username) is
// exposed so the form can pre-fill it; the password never leaves the server.
export const publicAppSettingsSchema = z.object({
  updatedAt: z.string().nullable(),
  dataforseo: z.object({
    configured: z.boolean(),
    login: z.string(),
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

export type PublicAppSettings = z.infer<typeof publicAppSettingsSchema>;
