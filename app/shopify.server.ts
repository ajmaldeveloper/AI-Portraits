import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import {
  GENERATION_UNIT_PRICE,
  PRO_PLAN,
  PRO_PLAN_USAGE_CAP,
} from "./services/billing/billing-config.server";

export { PRO_PLAN };

// The Free plan (1 style, 10 generations/month) needs no Shopify
// subscription at all — it's just the absence of an active Pro
// subscription. Pro is pure usage-based billing: no recurring fee,
// just a per-generation charge (see billing-config.server.ts for the
// actual $ amount, which is read from GENERATION_UNIT_PRICE so it can
// change without a code deploy). Shopify requires every usage-based
// plan to declare a monthly spending cap the merchant approves up
// front — PRO_PLAN_USAGE_CAP controls that; going over it pauses
// billing until the merchant approves a higher cap, it never charges
// past it silently.

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: {
    [PRO_PLAN]: {
      lineItems: [
        {
          amount: PRO_PLAN_USAGE_CAP,
          currencyCode: "USD",
          interval: BillingInterval.Usage,
          terms: `$${GENERATION_UNIT_PRICE.toFixed(2)} per AI image generation`,
        },
      ],
    },
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
