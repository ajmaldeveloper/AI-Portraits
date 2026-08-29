// Builds the URL for Shopify's own hosted plan-selection page. Under
// Shopify App Pricing, merchants pick/change plans there — the app
// can't create or cancel subscription charges itself via the Billing
// API (billing.request() throws "Cannot use the Billing API (to
// create charges) when on Shopify App Pricing"). Matches the pattern
// already used by the sibling wholesale-registration app.

type ShopifyPricingUrlOptions = {
  shopDomain: string;
  appHandle: string;
};

export function getShopifyPricingUrl({
  shopDomain,
  appHandle,
}: ShopifyPricingUrlOptions): string {
  const storeHandle = getStoreHandle(shopDomain);

  const normalizedAppHandle = appHandle.trim();

  if (!normalizedAppHandle) {
    throw new Error("SHOPIFY_APP_HANDLE is not configured.");
  }

  return [
    "https://admin.shopify.com/store",
    encodeURIComponent(storeHandle),
    "charges",
    encodeURIComponent(normalizedAppHandle),
    "pricing_plans",
  ].join("/");
}

function getStoreHandle(shopDomain: string): string {
  const normalizedDomain = shopDomain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");

  const storeHandle = normalizedDomain.replace(/\.myshopify\.com$/, "");

  if (!storeHandle) {
    throw new Error("A valid Shopify shop domain is required.");
  }

  return storeHandle;
}
