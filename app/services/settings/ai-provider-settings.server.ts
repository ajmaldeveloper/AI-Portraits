import prisma from "../../db.server";
import {
  decryptSecret,
  encryptSecret,
  lastFourOf,
} from "../security/secret-box.server";
import {
  getProviderDefinition,
  isKnownModel,
} from "../ai/provider-registry.server";

function requireShop(shop: string) {
  const normalized = shop.trim();

  if (!normalized) {
    throw new Error("Shop is required.");
  }

  return normalized;
}

export type AIProviderSettingsSummary = {
  configured: boolean;
  provider: string | null;
  model: string | null;
  apiKeyLastFour: string | null;
  updatedAt: string | null;
};

/**
 * Merchant-facing, display-safe view — the decrypted key never leaves
 * getDecryptedAIProviderCredentials, which only generation code calls.
 */
export async function getAIProviderSettingsSummary(
  shop: string,
): Promise<AIProviderSettingsSummary> {
  const normalizedShop = requireShop(shop);

  const settings = await prisma.shopAIProviderSettings.findUnique({
    where: {
      shop: normalizedShop,
    },
  });

  if (!settings) {
    return {
      configured: false,
      provider: null,
      model: null,
      apiKeyLastFour: null,
      updatedAt: null,
    };
  }

  return {
    configured: true,
    provider: settings.provider,
    model: settings.model,
    apiKeyLastFour: settings.apiKeyLastFour,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

export type SaveAIProviderSettingsInput = {
  provider: string;
  model: string;
  /** Omit or pass empty to keep the currently-stored key unchanged. */
  apiKey?: string;
};

export async function saveAIProviderSettings(
  shop: string,
  input: SaveAIProviderSettingsInput,
) {
  const normalizedShop = requireShop(shop);

  const providerDefinition = getProviderDefinition(input.provider);

  if (!providerDefinition) {
    throw new Error("Choose a supported AI provider.");
  }

  if (!isKnownModel(input.provider, input.model)) {
    throw new Error("Choose a supported model for this provider.");
  }

  const newApiKey = input.apiKey?.trim();

  const existing = await prisma.shopAIProviderSettings.findUnique({
    where: {
      shop: normalizedShop,
    },
  });

  // A key from one provider is meaningless to another, so switching
  // providers always requires a fresh key — only a same-provider model
  // change may reuse the one already on file.
  const providerChanged = existing
    ? existing.provider !== input.provider
    : true;

  if (!newApiKey && providerChanged) {
    throw new Error(
      existing
        ? "An API key is required when switching providers."
        : "An API key is required to configure this provider.",
    );
  }

  const apiKeySecret = newApiKey
    ? encryptSecret(newApiKey)
    : existing!.apiKeySecret;

  const apiKeyLastFour = newApiKey
    ? lastFourOf(newApiKey)
    : existing!.apiKeyLastFour;

  await prisma.shopAIProviderSettings.upsert({
    where: {
      shop: normalizedShop,
    },

    create: {
      shop: normalizedShop,
      provider: input.provider,
      model: input.model,
      apiKeySecret,
      apiKeyLastFour,
      extraConfig: {},
    },

    update: {
      provider: input.provider,
      model: input.model,
      apiKeySecret,
      apiKeyLastFour,
    },
  });
}

export async function removeAIProviderSettings(shop: string) {
  const normalizedShop = requireShop(shop);

  await prisma.shopAIProviderSettings.deleteMany({
    where: {
      shop: normalizedShop,
    },
  });
}

export type DecryptedAIProviderCredentials = {
  provider: string;
  model: string;
  apiKey: string;
};

/**
 * Server-internal only — used exclusively by the generation adapters.
 * Never expose the return value to a route's loader/action response.
 */
export async function getDecryptedAIProviderCredentials(
  shop: string,
): Promise<DecryptedAIProviderCredentials | null> {
  const normalizedShop = requireShop(shop);

  const settings = await prisma.shopAIProviderSettings.findUnique({
    where: {
      shop: normalizedShop,
    },
  });

  if (!settings) {
    return null;
  }

  return {
    provider: settings.provider,
    model: settings.model,
    apiKey: decryptSecret(settings.apiKeySecret),
  };
}
