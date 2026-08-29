export * from "./billing-config";

// The app's handle, assigned by Shopify (Partner Dashboard > Basic app
// information / shopify.app.toml's `handle` field). Required to build
// the Shopify-hosted plan-selection URL merchants are redirected to —
// Shopify App Pricing does not allow apps to create subscription
// charges themselves via the Billing API. Reads process.env, so it
// stays in the .server file (route components must never import this
// module directly — see billing-config.ts for the plain constants).
export function getShopifyAppHandle(): string {
  const handle = process.env.SHOPIFY_APP_HANDLE?.trim();

  if (!handle) {
    throw new Error("SHOPIFY_APP_HANDLE is not configured.");
  }

  return handle;
}
