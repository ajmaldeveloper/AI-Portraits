import { StyleStatus } from "@prisma/client";

import prisma from "../../db.server";
import { unauthenticated } from "../../shopify.server";
import {
  FREE_PLAN_MONTHLY_GENERATION_LIMIT,
  FREE_PLAN_STYLE_LIMIT,
  PRO_PLAN,
  PRO_PLAN_HANDLE,
  PRO_PLAN_MONTHLY_PRICE,
  PRO_PLAN_TRIAL_DAYS,
  PRO_PLAN_YEARLY_PRICE,
} from "./billing-config.server";

// Plan status is never cached locally — it's read live from Shopify on
// every check via raw GraphQL (through unauthenticated.admin, which
// works both inside an authenticated admin request AND inside the
// app-proxy's fire-and-forget customer-generation flow, unlike the
// authenticate.admin()-only `billing` helper). This keeps the app
// immune to drift if a subscription is changed outside a live request
// (e.g. a merchant changes plan from Shopify's own billing page).

export class PlanLimitError extends Error {}

// --- Admin API check (fallback) --------------------------------------
//
// Reads whatever subscription is active on the shop's installation via
// the regular Admin API. Under Shopify App Pricing this may lag or
// miss brand-new subscriptions for some shops, so it's used only when
// the Partner API cross-check (the authoritative source for Shopify
// App Pricing — see below) is unavailable.

const ADMIN_ACTIVE_SUBSCRIPTION_QUERY = `#graphql
  query BillingActiveSubscription {
    currentAppInstallation {
      activeSubscriptions {
        id
        status
        name
      }
    }
  }
`;

type AdminActiveSubscriptionResponse = {
  data?: {
    currentAppInstallation?: {
      activeSubscriptions: Array<{
        id: string;
        status: string;
        name: string;
      }>;
    };
  };
};

async function getAdminActiveSubscriptionName(
  shop: string,
): Promise<string | null> {
  const { admin } = await unauthenticated.admin(shop);

  const response = await admin.graphql(ADMIN_ACTIVE_SUBSCRIPTION_QUERY);

  const payload = (await response.json()) as AdminActiveSubscriptionResponse;

  const subscriptions =
    payload.data?.currentAppInstallation?.activeSubscriptions ?? [];

  const active = subscriptions.find((subscription) => subscription.status === "ACTIVE");

  return active?.name?.trim() ?? null;
}

// --- Partner API check (primary) --------------------------------------
//
// The authoritative source for a shop's Shopify App Pricing plan —
// Shopify App Pricing subscriptions are created and managed through
// Shopify's own hosted pricing page, not through this app's Admin API
// session, so the Partner API's activeSubscription() is the reliable
// way to read which plan (by handle) a shop is actually on.

const PARTNER_API_VERSION = "2026-07";

const SHOP_IDENTITY_QUERY = `#graphql
  query BillingShopIdentity {
    shop {
      id
    }
  }
`;

async function getShopGid(shop: string): Promise<string | null> {
  try {
    const { admin } = await unauthenticated.admin(shop);

    const response = await admin.graphql(SHOP_IDENTITY_QUERY);

    const payload = (await response.json()) as {
      data?: { shop?: { id?: string } };
    };

    return payload.data?.shop?.id ?? null;
  } catch {
    return null;
  }
}

const PARTNER_ACTIVE_SUBSCRIPTION_QUERY = `#graphql
  query BillingPartnerActiveSubscription($appId: ID!, $shopId: ID!) {
    activeSubscription(appId: $appId, shopId: $shopId) {
      items {
        handle
      }
    }
  }
`;

type PartnerActiveSubscriptionResponse = {
  data?: {
    activeSubscription?: {
      items: Array<{ handle: string | null }>;
    } | null;
  };
  errors?: Array<{ message: string }>;
};

/**
 * Returns the active plan handle from the Partner API, or:
 * - `null` if confirmed the shop has no active Shopify App Pricing
 *   subscription (a real, negative answer).
 * - `undefined` if this check couldn't be completed at all (Partner
 *   API not configured, or the request itself failed) — callers must
 *   never treat this the same as `null`, since it means "unknown," not
 *   "not on Pro."
 */
async function getPartnerActivePlanHandle(
  shop: string,
): Promise<string | null | undefined> {
  const organizationId = process.env.SHOPIFY_PARTNER_ORGANIZATION_ID?.trim();

  const accessToken = process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN?.trim();

  const appGid = process.env.SHOPIFY_APP_GID?.trim();

  if (!organizationId || !accessToken || !appGid) {
    return undefined;
  }

  const shopGid = await getShopGid(shop);

  if (!shopGid) {
    return undefined;
  }

  try {
    const response = await fetch(
      `https://partners.shopify.com/${organizationId}/api/${PARTNER_API_VERSION}/graphql.json`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },

        body: JSON.stringify({
          query: PARTNER_ACTIVE_SUBSCRIPTION_QUERY,
          variables: { appId: appGid, shopId: shopGid },
        }),
      },
    );

    if (!response.ok) {
      return undefined;
    }

    const payload =
      (await response.json()) as PartnerActiveSubscriptionResponse;

    if (payload.errors && payload.errors.length > 0) {
      return undefined;
    }

    const subscription = payload.data?.activeSubscription;

    if (!subscription) {
      return null;
    }

    return subscription.items.find((item) => item.handle)?.handle ?? null;
  } catch {
    return undefined;
  }
}

export async function isShopOnProPlan(shop: string): Promise<boolean> {
  const partnerPlanHandle = await getPartnerActivePlanHandle(shop);

  if (partnerPlanHandle !== undefined) {
    return partnerPlanHandle?.toLowerCase() === PRO_PLAN_HANDLE;
  }

  // Partner API check couldn't be completed — fall back to the Admin
  // API's own view of the subscription rather than assuming Free.
  const adminSubscriptionName = await getAdminActiveSubscriptionName(shop);

  return adminSubscriptionName?.toLowerCase() === PRO_PLAN.toLowerCase();
}

/**
 * Per-generation usage billing is deferred — Pro is a flat monthly/
 * yearly subscription for now (configured entirely in Partner
 * Dashboard > Pricing, not in code). Kept as a no-op so its call sites
 * (customer-generation.server.ts, style-product-media.server.ts) don't
 * need to change when metered billing is added later via the App
 * Events API.
 */
export async function recordGenerationUsage(
  _shop: string,
  _description: string,
) {
  // Intentionally no-op — see comment above.
}

function startOfCurrentMonth() {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * Drafts are unlimited on every plan — only PUBLISHED styles are
 * capped on Free. A merchant can create and iterate on as many draft
 * prompts as they like; the plan only gates how many can be live at
 * once.
 */
export async function countPublishedStylesForShop(shop: string) {
  return prisma.style.count({
    where: { shop, status: StyleStatus.PUBLISHED },
  });
}

/**
 * Counts actual images produced this month, not Generation ledger rows
 * — one merchant "Generate more" call can produce up to 4 images in a
 * single Generation row, so counting rows would undercount against the
 * Free plan's per-image limit. StyleAsset rows with a generationId are
 * exactly the AI-produced images (PRODUCT_GENERATED for merchant
 * previews, CUSTOMER_RESULT for storefront generations) — uploads
 * never have a generationId, so they're correctly excluded.
 */
export async function countGenerationsThisMonth(shop: string) {
  return prisma.styleAsset.count({
    where: {
      generationId: { not: null },
      kind: { in: ["PRODUCT_GENERATED", "CUSTOMER_RESULT"] },
      createdAt: { gte: startOfCurrentMonth() },
      style: { shop },
    },
  });
}

/**
 * Throws PlanLimitError if a Free-plan shop already has its allowed
 * number of PUBLISHED styles live. Only relevant for a first-time
 * publish — updating an already-published style never goes through
 * this (see publishStyleToShopify, which only calls this when the
 * style isn't already PUBLISHED). Pro shops are never limited.
 */
export async function assertCanPublishStyle(shop: string) {
  const isPro = await isShopOnProPlan(shop);

  if (isPro) {
    return;
  }

  const publishedCount = await countPublishedStylesForShop(shop);

  if (publishedCount >= FREE_PLAN_STYLE_LIMIT) {
    throw new PlanLimitError(
      `The Free plan includes ${FREE_PLAN_STYLE_LIMIT} published prompt. Upgrade to Pro to publish more.`,
    );
  }
}

/**
 * Throws PlanLimitError if a Free-plan shop doesn't have enough of its
 * monthly generation allowance left for `count` more images (defaults
 * to 1). Returns whether the shop is on Pro, so callers know whether
 * to record billable usage after a successful generation.
 */
export async function assertCanGenerate(
  shop: string,
  count = 1,
): Promise<{ isPro: boolean }> {
  const isPro = await isShopOnProPlan(shop);

  if (isPro) {
    return { isPro: true };
  }

  const generationCount = await countGenerationsThisMonth(shop);

  if (generationCount + count > FREE_PLAN_MONTHLY_GENERATION_LIMIT) {
    throw new PlanLimitError(
      `The Free plan includes ${FREE_PLAN_MONTHLY_GENERATION_LIMIT} AI generations per month. Upgrade to Pro for unlimited generations.`,
    );
  }

  return { isPro: false };
}

export type ShopPlanSummary = {
  isPro: boolean;
  publishedStyleCount: number;
  publishedStyleLimit: number | null;
  generationsThisMonth: number;
  generationLimit: number | null;
  proPlanMonthlyPrice: number;
  proPlanYearlyPrice: number;
  proPlanTrialDays: number;
};

export async function getShopPlanSummary(
  shop: string,
): Promise<ShopPlanSummary> {
  const [isPro, publishedStyleCount, generationsThisMonth] = await Promise.all([
    isShopOnProPlan(shop),
    countPublishedStylesForShop(shop),
    countGenerationsThisMonth(shop),
  ]);

  return {
    isPro,
    publishedStyleCount,
    publishedStyleLimit: isPro ? null : FREE_PLAN_STYLE_LIMIT,
    generationsThisMonth,
    generationLimit: isPro ? null : FREE_PLAN_MONTHLY_GENERATION_LIMIT,
    proPlanMonthlyPrice: PRO_PLAN_MONTHLY_PRICE,
    proPlanYearlyPrice: PRO_PLAN_YEARLY_PRICE,
    proPlanTrialDays: PRO_PLAN_TRIAL_DAYS,
  };
}
