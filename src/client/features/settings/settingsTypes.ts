// Client-side settings form state. Secrets start blank and are only written
// to the server; the redacted public payload pre-fills the non-secret fields.
export type FormSettingsState = {
  dataforseo: { login: string; password: string };
  ai: {
    openrouterApiKey: string;
    openaiApiKey: string;
    anthropicApiKey: string;
    defaultModel: string;
    temperature: number;
    maxTokens: number;
  };
  branding: {
    appTitle: string;
    defaultRegion: string;
    currency: string;
  };
};

export const DEFAULT_FORM: FormSettingsState = {
  dataforseo: { login: "", password: "" },
  ai: {
    openrouterApiKey: "",
    openaiApiKey: "",
    anthropicApiKey: "",
    defaultModel: "",
    temperature: 1,
    maxTokens: 4096,
  },
  branding: {
    appTitle: "AbbaSeo",
    defaultRegion: "US",
    currency: "USD",
  },
};
