import { StyleStatus } from "@prisma/client";

import prisma from "../../db.server";
import { authenticate } from "../../shopify.server";
import { connectCartTransform } from "./cart-transform.server";

type AdminGraphqlClient = Awaited<
  ReturnType<typeof authenticate.admin>
>["admin"];

const METAFIELD_NAMESPACE = "$app";
const ADJUSTMENT_METAFIELD_KEY = "aig_adjustment_config";

// Kept identical (duplicated) in
// extensions/ai-art-generator-price-transform/src/cart_transform_run.graphql
// and .js, which read this fixed set of shard metafields.
const PRICING_SHARD_COUNT = 3;

function pricingShardMetafieldKey(shard: number) {
  return `aig_pricing_shard_${shard}`;
}

// Styles are distributed across a fixed number of "shard" metafields
// instead of one combined blob — a Function's jsonValue resolution
// caps out around 10KB per metafield, and CartTransform only exposes a
// static, non-list `metafield(key:)` field to input queries, so the
// shard count has to be fixed and known at query-authoring time.
// Deterministic hashing keeps a given style in the same shard across
// syncs.
function hashToShard(id: string, shardCount: number) {
  let hash = 0;

  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }

  return hash % shardCount;
}

const ADJUSTMENT_PRODUCT_HANDLE = "ai-art-studio-pricing-adjustment";
const ADJUSTMENT_PRODUCT_TITLE = "Winslet AI Portraits — pricing adjustment";
const ADJUSTMENT_PRODUCT_SKU = "AI-ART-STUDIO-ADJUSTMENT";

type GraphqlEnvelope<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

async function readGraphql<T>(response: Response) {
  return (await response.json()) as GraphqlEnvelope<T>;
}

function graphqlErrorMessage<T>(payload: GraphqlEnvelope<T>) {
  return payload.errors?.[0]?.message ?? null;
}

// --- Trusted pricing config (built from the DB, never from client input) --

type TrustedChoice = {
  id: string;
  priceDelta: string;
};

type TrustedOption = {
  id: string;
  axisRole: "SIZE" | "FRAMING" | null;
  choices: TrustedChoice[];
};

type TrustedStyle = {
  basePrice: string;
  options: TrustedOption[];
};

async function buildTrustedPricingConfig(shop: string) {
  const styles = await prisma.style.findMany({
    where: { shop, status: StyleStatus.PUBLISHED },
    select: {
      id: true,
      basePrice: true,
      options: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          axisRole: true,
          choices: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              priceDelta: true,
            },
          },
        },
      },
    },
  });

  const trustedStyles: Record<string, TrustedStyle> = {};

  for (const style of styles) {
    const options = style.options.filter((option) => option.choices.length > 0);

    // A style with no priced choices at all never needs Function
    // config — its single-variant price already IS the whole price,
    // nothing for the surcharge line to add and no Framing choice to
    // carry shipping.
    if (options.length === 0) {
      continue;
    }

    trustedStyles[style.id] = {
      basePrice: style.basePrice.toString(),
      options: options.map((option) => ({
        id: option.id,
        axisRole: option.axisRole,
        choices: option.choices.map((choice) => ({
          id: choice.id,
          priceDelta: (choice.priceDelta ?? 0).toString(),
        })),
      })),
    };
  }

  return trustedStyles;
}

// --- The invisible, never-customer-facing price-adjustment product -------
//
// A hidden (UNLISTED) product with exactly one variant, created lazily
// on first sync. Never selected by a customer — the Function
// references its variant id directly by GID, read back off its own
// config metafield, to carry the price surcharge on top of the
// line's own base price.
//
// There used to be a second carrier product here purely to make
// Shopify treat an order as requiring physical shipping when a
// Framing choice called for it (shipping is decided per-variant, not
// something a Cart Transform Function can set directly on a cart
// line) — removed once every product's own base variant was made to
// always require shipping (see style-publish.server.ts), since every
// order this app sells is a physical print regardless of framing.

type CarrierRecipe = {
  handle: string;
  title: string;
  sku: string;
};

async function findCarrierVariant(admin: AdminGraphqlClient, handle: string) {
  const response = await admin.graphql(
    `#graphql
      query AiArtGeneratorCarrierProduct($query: String!) {
        products(first: 1, query: $query) {
          nodes {
            id
            variants(first: 1) {
              nodes {
                id
              }
            }
          }
        }
      }
    `,
    { variables: { query: `handle:${handle}` } },
  );

  const payload = await readGraphql<{
    products?: {
      nodes?: Array<{
        id: string;
        variants?: { nodes?: Array<{ id: string }> };
      }>;
    };
  }>(response);

  const error = graphqlErrorMessage(payload);

  if (error) {
    throw new Error(error);
  }

  const product = payload.data?.products?.nodes?.[0];
  const variant = product?.variants?.nodes?.[0];

  if (!product || !variant) {
    return null;
  }

  return { productId: product.id, variantId: variant.id };
}

async function configureCarrierVariant(
  admin: AdminGraphqlClient,
  productId: string,
  variantId: string,
  recipe: CarrierRecipe,
) {
  const response = await admin.graphql(
    `#graphql
      mutation AiArtGeneratorConfigureCarrierVariant(
        $productId: ID!
        $variants: [ProductVariantsBulkInput!]!
      ) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        productId,
        variants: [
          {
            id: variantId,
            price: "0.01",
            inventoryPolicy: "CONTINUE",
            taxable: false,
            inventoryItem: {
              tracked: false,
              // Never its own shipping concern — it exists purely to
              // carry a price adjustment, quantity 1, alongside the
              // line's own already-physical variant.
              requiresShipping: false,
              sku: recipe.sku,
            },
          },
        ],
      },
    },
  );

  const payload = await readGraphql<{
    productVariantsBulkUpdate?: {
      productVariants?: Array<{ id: string }>;
      userErrors?: Array<{ message: string }>;
    };
  }>(response);

  const message =
    payload.data?.productVariantsBulkUpdate?.userErrors?.[0]?.message ??
    graphqlErrorMessage(payload);

  if (message) {
    throw new Error(message);
  }
}

async function createCarrierVariant(
  admin: AdminGraphqlClient,
  recipe: CarrierRecipe,
) {
  const response = await admin.graphql(
    `#graphql
      mutation AiArtGeneratorCreateCarrierProduct($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            id
            variants(first: 1) {
              nodes {
                id
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        product: {
          title: recipe.title,
          handle: recipe.handle,
          status: "UNLISTED",
          vendor: "Winslet AI Portraits",
          productType: "AI Art Studio Internal",
          tags: ["ai-art-studio-internal", "ai-art-studio-pricing"],
        },
      },
    },
  );

  const payload = await readGraphql<{
    productCreate?: {
      product?: { id: string; variants?: { nodes?: Array<{ id: string }> } } | null;
      userErrors?: Array<{ message: string }>;
    };
  }>(response);

  const message =
    payload.data?.productCreate?.userErrors?.[0]?.message ??
    graphqlErrorMessage(payload);

  if (message) {
    throw new Error(message);
  }

  const product = payload.data?.productCreate?.product;
  const variant = product?.variants?.nodes?.[0];

  if (!product || !variant) {
    throw new Error("Shopify did not return the internal pricing product.");
  }

  await configureCarrierVariant(admin, product.id, variant.id, recipe);

  return { productId: product.id, variantId: variant.id };
}

async function ensureCarrierVariant(
  admin: AdminGraphqlClient,
  recipe: CarrierRecipe,
) {
  const existing = await findCarrierVariant(admin, recipe.handle);

  if (existing) {
    await configureCarrierVariant(admin, existing.productId, existing.variantId, recipe);

    return existing;
  }

  return createCarrierVariant(admin, recipe);
}

const ADJUSTMENT_RECIPE: CarrierRecipe = {
  handle: ADJUSTMENT_PRODUCT_HANDLE,
  title: ADJUSTMENT_PRODUCT_TITLE,
  sku: ADJUSTMENT_PRODUCT_SKU,
};

async function setTrustedConfigMetafields(
  admin: AdminGraphqlClient,
  transformId: string,
  styles: Record<string, TrustedStyle>,
  adjustmentVariantId: string,
) {
  const shardPayloads: Array<Record<string, TrustedStyle>> = Array.from(
    { length: PRICING_SHARD_COUNT },
    () => ({}),
  );

  for (const [styleId, style] of Object.entries(styles)) {
    const shard = hashToShard(styleId, PRICING_SHARD_COUNT);

    shardPayloads[shard][styleId] = style;
  }

  const metafieldsInput = [
    {
      ownerId: transformId,
      namespace: METAFIELD_NAMESPACE,
      key: ADJUSTMENT_METAFIELD_KEY,
      type: "json",
      value: JSON.stringify({ version: 1, adjustmentVariantId }),
    },
    ...shardPayloads.map((payload, shard) => ({
      ownerId: transformId,
      namespace: METAFIELD_NAMESPACE,
      key: pricingShardMetafieldKey(shard),
      type: "json",
      value: JSON.stringify(payload),
    })),
  ];

  const response = await admin.graphql(
    `#graphql
      mutation AiArtGeneratorSetTrustedPricing($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `,
    { variables: { metafields: metafieldsInput } },
  );

  const payload = await readGraphql<{
    metafieldsSet?: {
      metafields?: Array<{ id: string }>;
      userErrors?: Array<{ message: string }>;
    };
  }>(response);

  const message =
    payload.data?.metafieldsSet?.userErrors?.[0]?.message ??
    graphqlErrorMessage(payload);

  if (message) {
    throw new Error(message);
  }
}

export type StylePricingSyncResult =
  | { ok: true; styleCount: number }
  | { ok: false; message: string };

/**
 * Rebuilds the Cart Transform Function's whole pricing config from the
 * DB and pushes it to Shopify — called whenever a Style's Product
 * options are saved. Always a full resync (every PUBLISHED style, not
 * just the one being edited), matching how the shard metafields
 * themselves work: each write replaces the complete set.
 */
export async function syncStylePricingToShopify(
  admin: AdminGraphqlClient,
  shop: string,
): Promise<StylePricingSyncResult> {
  try {
    const styles = await buildTrustedPricingConfig(shop);

    if (Object.keys(styles).length === 0) {
      return { ok: true, styleCount: 0 };
    }

    const connection = await connectCartTransform(admin);

    if (!connection.ok) {
      return { ok: false, message: connection.message };
    }

    const transformId = connection.status.id;

    if (!transformId) {
      return {
        ok: false,
        message: "Shopify pricing connected without returning a Cart Transform ID.",
      };
    }

    const adjustment = await ensureCarrierVariant(admin, ADJUSTMENT_RECIPE);

    await setTrustedConfigMetafields(
      admin,
      transformId,
      styles,
      adjustment.variantId,
    );

    return { ok: true, styleCount: Object.keys(styles).length };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Unable to sync Shopify pricing.",
    };
  }
}
