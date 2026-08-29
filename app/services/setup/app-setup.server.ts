import { getAIProviderSettingsSummary } from "../settings/ai-provider-settings.server";
import { getProviderDefinition } from "../ai/provider-registry.server";

// Centralized app-level setup checks — separate from Style readiness.
//
// These describe whether the app itself is correctly configured (AI
// provider, Shopify publishing scopes) rather than whether a single
// Style is ready to publish. Used by both the dashboard summary and the
// dedicated Setup page so the logic lives in one place.

export type AppSetupCheck = {
  key: "aiCredentials" | "publishingAccess";
  label: string;
  description: string;
  complete: boolean;
  details: Array<{ label: string; value: string }>;
  fixHref: string | null;
  fixLabel: string | null;
};

export type AppSetupUpcoming = {
  key: "storefrontExtension";
  label: string;
  description: string;
};

export async function getAppSetupChecks(session: {
  shop: string;
  scope?: string | null;
}): Promise<AppSetupCheck[]> {
  const grantedScopes = new Set(
    (session.scope ?? "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
  );

  const publishingAccess =
    grantedScopes.has("write_products") &&
    grantedScopes.has("write_publications");

  const aiSettings = await getAIProviderSettingsSummary(session.shop);

  const providerLabel = aiSettings.provider
    ? (getProviderDefinition(aiSettings.provider)?.label ?? aiSettings.provider)
    : null;

  return [
    {
      key: "aiCredentials",
      label: "AI provider",
      description:
        "Your own AI provider and API key, required to generate product and customer artwork.",
      complete: aiSettings.configured,

      details: [
        {
          label: "Provider",
          value: providerLabel ?? "Not configured",
        },

        {
          label: "Model",
          value: aiSettings.model ?? "Not configured",
        },
      ],

      fixHref: aiSettings.configured ? null : "/app/settings",
      fixLabel: aiSettings.configured ? null : "Configure AI provider",
    },

    {
      key: "publishingAccess",
      label: "Shopify publishing access",
      description: "Required to create and publish Shopify products.",
      complete: publishingAccess,

      details: [
        {
          label: "write_products",
          value: grantedScopes.has("write_products") ? "Granted" : "Missing",
        },

        {
          label: "write_publications",
          value: grantedScopes.has("write_publications")
            ? "Granted"
            : "Missing",
        },
      ],

      // No in-app fix — this is a Shopify OAuth scope granted at
      // install time, changed via shopify.app.toml + re-auth.
      fixHref: null,
      fixLabel: null,
    },
  ];
}

export function getAppSetupUpcoming(): AppSetupUpcoming[] {
  return [
    {
      key: "storefrontExtension",
      label: "Storefront extension",
      description:
        "A Theme App Extension will let customers upload photos and generate artwork directly on the product page. Not built yet.",
    },
  ];
}
