// Catalog of AI providers merchants can bring their own credentials
// for. This is display/validation metadata only — no secrets live
// here. Adding a new provider means: add its entry here, then add a
// matching adapter in app/services/ai/ and a branch in
// style-product-media.server.ts's provider switch.

export type AIModelOption = {
  id: string;
  label: string;
};

export type AIProviderDefinition = {
  id: "openai" | "google" | "flux";
  label: string;
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  apiKeyHelp: string;
  apiKeyDocsUrl: string;
  models: AIModelOption[];
};

export const AI_PROVIDERS: AIProviderDefinition[] = [
  {
    id: "openai",
    label: "OpenAI",
    apiKeyLabel: "OpenAI API key",
    apiKeyPlaceholder: "sk-...",
    apiKeyHelp: "From your OpenAI account, under API keys.",
    apiKeyDocsUrl: "https://platform.openai.com/api-keys",
    models: [
      { id: "chatgpt-image-latest", label: "ChatGPT Image (latest)" },
      { id: "gpt-image-1", label: "GPT Image 1" },
      { id: "gpt-image-1-mini", label: "GPT Image 1 Mini (fastest)" },
      { id: "gpt-image-1.5", label: "GPT Image 1.5" },
      { id: "gpt-image-2", label: "GPT Image 2 (recommended)" },
      {
        id: "gpt-image-2-2026-04-21",
        label: "GPT Image 2 (dated 2026-04-21)",
      },
    ],
  },
  {
    id: "google",
    label: "Google (Gemini)",
    apiKeyLabel: "Gemini API key",
    apiKeyPlaceholder: "AIza...",
    apiKeyHelp: "From Google AI Studio, under API keys.",
    apiKeyDocsUrl: "https://aistudio.google.com/apikey",
    models: [
      {
        id: "gemini-3.1-flash-image",
        label: "Gemini 3.1 Flash Image (recommended)",
      },
      {
        id: "gemini-3.1-flash-lite-image",
        label: "Gemini 3.1 Flash Lite Image (fastest)",
      },
      {
        id: "gemini-3-pro-image",
        label: "Gemini 3 Pro Image (highest quality)",
      },
      {
        id: "gemini-2.5-flash-image",
        label: "Gemini 2.5 Flash Image (Nano Banana, legacy)",
      },
    ],
  },
  {
    id: "flux",
    label: "Black Forest Labs (FLUX)",
    apiKeyLabel: "BFL API key",
    apiKeyPlaceholder: "bfl-...",
    apiKeyHelp: "From your Black Forest Labs account, under API keys.",
    apiKeyDocsUrl: "https://api.bfl.ai/auth/profile",
    models: [
      { id: "flux-pro-1.1", label: "FLUX 1.1 Pro (recommended)" },
      {
        id: "flux-pro-1.1-ultra",
        label: "FLUX 1.1 Pro Ultra (highest quality)",
      },
      { id: "flux-dev", label: "FLUX Dev" },
    ],
  },
];

export function getProviderDefinition(
  providerId: string,
): AIProviderDefinition | null {
  return AI_PROVIDERS.find((provider) => provider.id === providerId) ?? null;
}

export function isKnownModel(providerId: string, modelId: string): boolean {
  const provider = getProviderDefinition(providerId);

  return provider
    ? provider.models.some((model) => model.id === modelId)
    : false;
}
