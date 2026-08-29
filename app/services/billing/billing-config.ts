// Plain constants, safe to import from both server code and route
// components (no .server suffix — anything env-dependent lives in
// billing-config.server.ts instead, which re-exports these too).

// Display name shown in-app. Must match the plan's "Display name" set
// in Partner Dashboard > Pricing, since isShopOnProPlan() matches the
// merchant's active Admin API subscription name against this.
export const PRO_PLAN = "Pro";

// Plan handles as assigned in Partner Dashboard > Pricing when each
// plan was created there — shown as "Internal plan handle" on each
// plan's edit screen, and permanent ("can't be changed later"). Used
// to read the Partner API's activeSubscription().items[].handle and to
// build the Shopify-hosted pricing page URL.
export const FREE_PLAN_HANDLE = "free";
export const PRO_PLAN_HANDLE = "pro";

// Display-only — the actual charge is entirely configured and billed
// by Shopify under Shopify App Pricing (Partner Dashboard > Pricing),
// not by this app. Keep these in sync with that page if the price ever
// changes there.
export const PRO_PLAN_MONTHLY_PRICE = 19.99;
export const PRO_PLAN_YEARLY_PRICE = 199.99;
export const PRO_PLAN_TRIAL_DAYS = 3;

// Free plan limits — enforced locally, independent of Shopify billing.
export const FREE_PLAN_STYLE_LIMIT = 1;
export const FREE_PLAN_MONTHLY_GENERATION_LIMIT = 10;
