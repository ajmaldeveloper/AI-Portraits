// Plain constants only — no imports from shopify.server.ts here, since
// shopify.server.ts itself needs these to build its billing config
// (importing the other way would be circular).

export const PRO_PLAN = "Pro";

// What Pro-plan merchants pay per AI image generation, via Shopify's
// usage-based Billing API. Env-configurable so it can change without a
// code deploy.
export const GENERATION_UNIT_PRICE = Number(
  process.env.GENERATION_UNIT_PRICE ?? "0.5",
);

// The monthly spending cap a Pro-plan merchant approves up front, as
// Shopify requires for any usage-based plan. Once hit, further usage
// charges pause until the merchant approves a higher cap — it's a
// safety ceiling, not a target.
export const PRO_PLAN_USAGE_CAP = Number(
  process.env.PRO_PLAN_USAGE_CAP ?? "100",
);

// Free plan: always free, no Shopify subscription at all.
export const FREE_PLAN_STYLE_LIMIT = 1;

export const FREE_PLAN_MONTHLY_GENERATION_LIMIT = 10;
