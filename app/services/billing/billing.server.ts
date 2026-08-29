import { StyleStatus } from "@prisma/client";

import prisma from "../../db.server";
import { unauthenticated } from "../../shopify.server";
import {
  FREE_PLAN_MONTHLY_GENERATION_LIMIT,
  FREE_PLAN_STYLE_LIMIT,
  GENERATION_UNIT_PRICE,
} from "./billing-config.server";

// Plan status is never cached locally — it's read live from Shopify on
// every check via a raw GraphQL call (through unauthenticated.admin,
// which works both inside an authenticated admin request AND inside
// the app-proxy's fire-and-forget customer-generation flow, unlike the
// authenticate.admin()-only `billing` helper). This keeps the app
// immune to drift if a subscription is cancelled/changed outside a
// live request (e.g. a merchant cancels from the Shopify billing
// settings page directly).

export class PlanLimitError extends Error {}

const ACTIVE_SUBSCRIPTION_QUERY = `#graphql
  query BillingActiveSubscription {
    currentAppInstallation {
      activeSubscriptions {
        id
        status
        lineItems {
          id
          plan {
            pricingDetails {
              __typename
            }
          }
        }
      }
    }
  }
`;

type ActiveSubscriptionResponse = {
  data?: {
    currentAppInstallation?: {
      activeSubscriptions: Array<{
        id: string;
        status: string;
        lineItems: Array<{
          id: string;
          plan: {
            pricingDetails: {
              __typename: string;
            };
          };
        }>;
      }>;
    };
  };
};

async function findActiveUsageLineItemId(shop: string): Promise<string | null> {
  const { admin } = await unauthenticated.admin(shop);

  const response = await admin.graphql(ACTIVE_SUBSCRIPTION_QUERY);

  const payload = (await response.json()) as ActiveSubscriptionResponse;

  const subscriptions =
    payload.data?.currentAppInstallation?.activeSubscriptions ?? [];

  for (const subscription of subscriptions) {
    if (subscription.status !== "ACTIVE") {
      continue;
    }

    const usageLineItem = subscription.lineItems.find(
      (lineItem) =>
        lineItem.plan.pricingDetails.__typename === "AppUsagePricing",
    );

    if (usageLineItem) {
      return usageLineItem.id;
    }
  }

  return null;
}

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
      lineItems {
        plan {
          pricingDetails {
            __typename
          }
        }
      }
    }
  }
`;

type PartnerActiveSubscriptionResponse = {
  data?: {
    activeSubscription?: {
      lineItems: Array<{
        plan: {
          pricingDetails: {
            __typename: string;
          };
        };
      }>;
    } | null;
  };
  errors?: Array<{ message: string }>;
};

/**
 * Secondary cross-check via the Partner API, used only when the Admin
 * API (findActiveUsageLineItemId) finds no active subscription — a
 * safety net so one API's hiccup can never wrongly make a paying
 * merchant look unpaid (same reasoning the sibling wholesale-
 * registration app uses for its own Admin-API cross-check, just
 * mirrored the other way — this app's primary check is the Admin API).
 * Returns null (not false) when Partner API credentials aren't
 * configured, or the check itself fails for any reason, so callers
 * can tell "confirmed not on Pro" apart from "couldn't confirm either
 * way" — a null here must never be treated as a negative answer.
 */
async function confirmProPlanViaPartnerApi(
  shop: string,
): Promise<boolean | null> {
  const organizationId = process.env.SHOPIFY_PARTNER_ORGANIZATION_ID?.trim();

  const accessToken = process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN?.trim();

  const appGid = process.env.SHOPIFY_APP_GID?.trim();

  if (!organizationId || !accessToken || !appGid) {
    return null;
  }

  const shopGid = await getShopGid(shop);

  if (!shopGid) {
    return null;
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
      return null;
    }

    const payload =
      (await response.json()) as PartnerActiveSubscriptionResponse;

    if (payload.errors && payload.errors.length > 0) {
      return null;
    }

    const subscription = payload.data?.activeSubscription;

    if (!subscription) {
      return false;
    }

    return subscription.lineItems.some(
      (lineItem) =>
        lineItem.plan.pricingDetails.__typename === "AppUsagePricing",
    );
  } catch {
    return null;
  }
}

export async function isShopOnProPlan(shop: string): Promise<boolean> {
  const activeViaAdminApi = (await findActiveUsageLineItemId(shop)) !== null;

  if (activeViaAdminApi) {
    return true;
  }

  // The Admin API found nothing — cross-check the Partner API before
  // concluding this shop really isn't on Pro. A no-op (returns null,
  // treated as "not confirmed active") when Partner API credentials
  // aren't configured, so this is purely additive when unset.
  const activeViaPartnerApi = await confirmProPlanViaPartnerApi(shop);

  return activeViaPartnerApi === true;
}

const CREATE_USAGE_RECORD_MUTATION = `#graphql
  mutation BillingCreateUsageRecord(
    $subscriptionLineItemId: ID!
    $description: String!
    $price: MoneyInput!
  ) {
    appUsageRecordCreate(
      subscriptionLineItemId: $subscriptionLineItemId
      description: $description
      price: $price
    ) {
      appUsageRecord {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

type CreateUsageRecordResponse = {
  data?: {
    appUsageRecordCreate?: {
      appUsageRecord: { id: string } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  };
};

/**
 * Charges a Pro-plan shop $GENERATION_UNIT_PRICE for one AI generation.
 * A no-op (not an error) on the Free plan — there's nothing to charge.
 * Never throws: billing must never block or fail a generation that has
 * already succeeded, so any failure here is logged and swallowed.
 */
export async function recordGenerationUsage(shop: string, description: string) {
  try {
    const lineItemId = await findActiveUsageLineItemId(shop);

    if (!lineItemId) {
      return;
    }

    const { admin } = await unauthenticated.admin(shop);

    const response = await admin.graphql(CREATE_USAGE_RECORD_MUTATION, {
      variables: {
        subscriptionLineItemId: lineItemId,
        description,
        price: {
          amount: GENERATION_UNIT_PRICE,
          currencyCode: "USD",
        },
      },
    });

    const payload = (await response.json()) as CreateUsageRecordResponse;

    const userErrors = payload.data?.appUsageRecordCreate?.userErrors;

    if (userErrors && userErrors.length > 0) {
      console.error("Usage record creation returned userErrors", userErrors);
    }
  } catch (error) {
    console.error("Could not record generation usage", error);
  }
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
  generationUnitPrice: number;
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
    generationUnitPrice: GENERATION_UNIT_PRICE,
  };
}
