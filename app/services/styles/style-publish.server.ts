import { StyleStatus } from "@prisma/client";

import prisma from "../../db.server";
import { authenticate } from "../../shopify.server";
import { assertCanPublishStyle } from "../billing/billing.server";
import { createSignedStyleAssetUrl } from "../media/media-signing.server";
import { findOnlineStorePublicationId } from "../shopify/publications.server";
import { requireStyleForShop } from "./style.server";
import {
  isStylePublishReady,
  isStyleUpdateReady,
} from "./style-readiness.server";
import { syncStylePricingToShopify } from "./style-pricing-sync.server";

// M5 — the Shopify Publish engine.
//
// This is the only place that creates or mutates the Shopify product for a
// Style. It is designed to be safely retried: the Shopify product ID is
// persisted the moment Shopify returns one, before any further step runs,
// so a later failure (media, publication) never causes a duplicate
// product on retry — the retry resumes against the existing product.
//
// Product options (Size, Framing, Mat color, everything on the Product
// options tab) are never modeled as real Shopify product options/
// variants — pricing for them is applied at checkout by the
// ai-art-generator-price-transform Cart Transform Function instead
// (see style-pricing-sync.server.ts). The Shopify product this file
// manages is always a plain single-variant product priced at the
// Style's flat basePrice.

type AdminGraphqlClient = Awaited<
  ReturnType<typeof authenticate.admin>
>["admin"];

type StyleForPublish = Awaited<ReturnType<typeof requireStyleForShop>>;

const publishableStatuses = new Set<StyleStatus>([
  StyleStatus.DRAFT,
  StyleStatus.PUBLISH_ERROR,
  StyleStatus.PUBLISHED,
  StyleStatus.UNPUBLISHED,
]);

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function descriptionToHtml(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  return trimmed
    .split(/\n{2,}/)
    .map(
      (paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`,
    )
    .join("");
}

function assertNoGraphqlErrors(payload: {
  errors?: Array<{ message: string }>;
}) {
  if (payload.errors && payload.errors.length > 0) {
    throw new Error(payload.errors.map((error) => error.message).join(" "));
  }
}

type ProductSetResponse = {
  data?: {
    productSet?: {
      product: {
        id: string;
        handle: string;
        variants: {
          nodes: Array<{ id: string }>;
        };
        media: {
          nodes: Array<{ id: string }>;
        };
      } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  };
  errors?: Array<{ message: string }>;
};

const PRODUCT_SET_MUTATION = `#graphql
  mutation StylePublishProductSet(
    $identifier: ProductSetIdentifiers
    $input: ProductSetInput!
  ) {
    productSet(identifier: $identifier, input: $input, synchronous: true) {
      product {
        id
        handle
        variants(first: 1) {
          nodes {
            id
          }
        }
        media(first: 50, sortKey: POSITION) {
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
`;

function numericIdFromGid(gid: string): string {
  const segments = gid.split("/");

  return segments[segments.length - 1] ?? gid;
}

function extractStaleVariantIds(errors: { message: string }[]): Set<string> {
  const ids = new Set<string>();

  for (const error of errors) {
    const match = error.message.match(
      /variant ids? do not exist:\s*\[([^\]]*)\]/i,
    );

    if (!match) {
      continue;
    }

    for (const id of match[1].split(",")) {
      const trimmed = id.trim();

      if (trimmed) {
        ids.add(trimmed);
      }
    }
  }

  return ids;
}

type UpsertResult = {
  productId: string;
  handle: string;
  variantId: string | null;
  mediaAssignments: Array<{ assetId: string; shopifyMediaId: string }>;
};

async function upsertShopifyProduct(
  admin: AdminGraphqlClient,
  style: StyleForPublish,
  requestUrl: string,
): Promise<UpsertResult> {
  // Every image in the gallery is product media — there's no separate
  // "select this one" step, so this is just the whole gallery.
  const galleryAssets = style.assets.filter(
    (asset) =>
      asset.kind === "PRODUCT_GENERATED" || asset.kind === "PRODUCT_SELECTED",
  );

  const productSettings = jsonObject(style.productSettings);

  const existingVariantId =
    typeof productSettings.defaultVariantId === "string"
      ? productSettings.defaultVariantId
      : null;

  // Already-attached assets are normally referenced by their known
  // Shopify media ID (kept as-is), and new ones submitted by URL —
  // except when recreating the product from scratch (see below), where
  // every known id belongs to the now-deleted product and is useless,
  // so everything must go through the URL path to be freshly attached
  // to the new one.
  function buildInput(options: {
    forceRecreate: boolean;
    forceReuploadMedia?: boolean;
    dropStaleVariantId?: boolean;
  }) {
    const reuploadMedia = options.forceRecreate || options.forceReuploadMedia;

    const knownAssets = reuploadMedia
      ? []
      : galleryAssets.filter((asset) => asset.shopifyMediaId);

    const newAssets = reuploadMedia
      ? galleryAssets
      : galleryAssets.filter((asset) => !asset.shopifyMediaId);

    const files = [
      ...knownAssets.map((asset) => ({ id: asset.shopifyMediaId as string })),

      ...newAssets.map((asset) => ({
        originalSource: createSignedStyleAssetUrl(
          requestUrl,
          asset.id,
          style.shop,
        ),

        alt: asset.altText || `${style.name} product image`,

        contentType: "IMAGE",
      })),
    ];

    const keptVariantId =
      !options.forceRecreate && !options.dropStaleVariantId
        ? existingVariantId
        : null;

    const input = {
      title: style.productTitle,

      descriptionHtml: descriptionToHtml(style.productDescription),

      tags: stringArray(style.tags),

      status: "ACTIVE",

      collections: stringArray(style.collectionIds),

      metafields: [
        {
          namespace: "$app",
          key: "style_id",
          type: "single_line_text_field",
          value: style.id,
        },
      ],

      // Always a plain single-variant product — Product options (Size,
      // Framing, everything on the Product options tab) are priced by
      // the Cart Transform Function at checkout instead of being
      // modeled as Shopify product options/variants. See this file's
      // top-of-file comment.
      productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],

      variants: [
        {
          ...(keptVariantId ? { id: keptVariantId } : {}),
          price: style.basePrice.toString(),
          compareAtPrice: style.compareAtPrice
            ? style.compareAtPrice.toString()
            : null,
          optionValues: [{ optionName: "Title", name: "Default Title" }],
          // Made to order from the customer's own upload — there's no
          // real stock to run out of, so the variant always stays
          // purchasable regardless of on-hand quantity (inventoryPolicy
          // CONTINUE). Inventory itself stays tracked (not tracked:
          // false) so the merchant still gets normal sold-count
          // reporting. requiresShipping is always false here — a
          // Framing choice that needs physical shipping carries it via
          // a second, invisible cart line instead (see
          // style-pricing-sync.server.ts), never via this variant.
          inventoryItem: {
            tracked: true,
            requiresShipping: false,
          },
          inventoryPolicy: "CONTINUE",
        },
      ],

      // Always synced, even when empty — the gallery IS the product's
      // media now (no separate "select this one" step), so an empty
      // gallery correctly means the live product should end up with no
      // media too, not "leave whatever was there before untouched".
      files,
    };

    return { input, knownAssets, newAssets };
  }

  let { input, knownAssets, newAssets } = buildInput({
    forceRecreate: false,
  });

  let response = await admin.graphql(PRODUCT_SET_MUTATION, {
    variables: {
      identifier: style.shopifyProductId
        ? { id: style.shopifyProductId }
        : null,

      input,
    },
  });

  let payload = (await response.json()) as ProductSetResponse;

  // The linked product was deleted outside the app (e.g. from Shopify
  // admin directly) — the stored shopifyProductId no longer resolves.
  // Recreate the product from scratch rather than leaving this Style
  // permanently stuck failing to publish. Shopify reports this as a
  // userError on the mutation (not a top-level GraphQL error), so both
  // need checking.
  const linkedProductMissing =
    Boolean(style.shopifyProductId) &&
    [
      ...(payload.errors ?? []),
      ...(payload.data?.productSet?.userErrors ?? []),
    ].some((error) => /not found/i.test(error.message));

  if (linkedProductMissing) {
    ({ input, knownAssets, newAssets } = buildInput({
      forceRecreate: true,
    }));

    response = await admin.graphql(PRODUCT_SET_MUTATION, {
      variables: {
        identifier: null,
        input,
      },
    });

    payload = (await response.json()) as ProductSetResponse;
  }

  // A previously-attached file's shopifyMediaId can go stale on
  // Shopify's side — stuck in a FAILED processing state, or simply no
  // longer resolving ("Media ids [...] do not exist", e.g. if it was
  // removed directly in Shopify admin) — and referencing it again by id
  // is then rejected. Re-uploading everything fresh by URL sidesteps
  // the broken reference; this is safe to retry blind (not just for the
  // one affected asset) since files is a full sync anyway.
  const staleMediaReference = (payload.data?.productSet?.userErrors ?? []).some(
    (error) =>
      /FAILED state/i.test(error.message) ||
      /media ids? .*(do not|does not) exist/i.test(error.message),
  );

  if (staleMediaReference && knownAssets.length > 0) {
    ({ input, knownAssets, newAssets } = buildInput({
      forceRecreate: false,
      forceReuploadMedia: true,
    }));

    response = await admin.graphql(PRODUCT_SET_MUTATION, {
      variables: {
        identifier: style.shopifyProductId
          ? { id: style.shopifyProductId }
          : null,

        input,
      },
    });

    payload = (await response.json()) as ProductSetResponse;
  }

  // The one existing variant's id can also go stale, the same way
  // media ids can — most commonly because it was deleted directly in
  // Shopify admin. Dropping it lets Shopify create a fresh replacement
  // variant instead of failing the whole publish.
  const staleVariantIds = extractStaleVariantIds(
    payload.data?.productSet?.userErrors ?? [],
  );

  if (staleVariantIds.size > 0) {
    ({ input, knownAssets, newAssets } = buildInput({
      forceRecreate: false,
      dropStaleVariantId: true,
    }));

    response = await admin.graphql(PRODUCT_SET_MUTATION, {
      variables: {
        identifier: style.shopifyProductId
          ? { id: style.shopifyProductId }
          : null,

        input,
      },
    });

    payload = (await response.json()) as ProductSetResponse;
  }

  assertNoGraphqlErrors(payload);

  const userErrors = payload.data?.productSet?.userErrors ?? [];

  if (userErrors.length > 0) {
    throw new Error(userErrors.map((error) => error.message).join(" "));
  }

  const product = payload.data?.productSet?.product;

  if (!product) {
    throw new Error("Shopify did not return a product for this Style.");
  }

  // New media is appended after the already-known media we referenced by
  // id, and Shopify returns product media sorted by position, so the
  // tail of the response (after the known ids) is the newly attached
  // files, in the order they were submitted.
  const knownMediaIds = new Set(
    knownAssets.map((asset) => asset.shopifyMediaId),
  );

  const newMediaIds = product.media.nodes
    .map((node) => node.id)
    .filter((id) => !knownMediaIds.has(id))
    .slice(0, newAssets.length);

  const mediaAssignments = newAssets
    .map((asset, index) => ({
      assetId: asset.id,
      shopifyMediaId: newMediaIds[index],
    }))
    .filter(
      (assignment): assignment is { assetId: string; shopifyMediaId: string } =>
        Boolean(assignment.shopifyMediaId),
    );

  return {
    productId: product.id,
    handle: product.handle,
    variantId: product.variants.nodes[0]?.id ?? existingVariantId,
    mediaAssignments,
  };
}

async function syncAttachedMedia(
  assignments: Array<{ assetId: string; shopifyMediaId: string }>,
) {
  if (assignments.length === 0) {
    return;
  }

  await prisma.$transaction(
    assignments.map((assignment) =>
      prisma.styleAsset.update({
        where: {
          id: assignment.assetId,
        },

        data: {
          shopifyMediaId: assignment.shopifyMediaId,
        },
      }),
    ),
  );
}

type PublishablePublishResponse = {
  data?: {
    publishablePublish?: {
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  };
  errors?: Array<{ message: string }>;
};

const PUBLISHABLE_PUBLISH_MUTATION = `#graphql
  mutation StylePublishToOnlineStore($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors {
        field
        message
      }
    }
  }
`;

async function publishProductToOnlineStore(
  admin: AdminGraphqlClient,
  productId: string,
) {
  const publicationId = await findOnlineStorePublicationId(admin);

  const response = await admin.graphql(PUBLISHABLE_PUBLISH_MUTATION, {
    variables: {
      id: productId,
      input: [{ publicationId }],
    },
  });

  const payload = (await response.json()) as PublishablePublishResponse;

  assertNoGraphqlErrors(payload);

  const userErrors = payload.data?.publishablePublish?.userErrors ?? [];

  if (userErrors.length > 0) {
    throw new Error(userErrors.map((error) => error.message).join(" "));
  }
}

export type PublishStyleResult = {
  shopifyProductId: string;
  shopifyProductHandle: string;
};

export async function publishStyleToShopify(
  admin: AdminGraphqlClient,
  shop: string,
  styleId: string,
  requestUrl: string,
): Promise<PublishStyleResult> {
  const style = await requireStyleForShop(shop, styleId);

  if (!publishableStatuses.has(style.status)) {
    throw new Error(
      `This Style cannot be published while its status is ${style.status}.`,
    );
  }

  const readinessCheckPasses =
    style.status === StyleStatus.PUBLISHED
      ? isStyleUpdateReady(style)
      : isStylePublishReady(style);

  if (!readinessCheckPasses) {
    throw new Error(
      "Complete the publishing checklist before publishing this Style.",
    );
  }

  // Only a first-time publish is gated — updating a style that's
  // already PUBLISHED never counts against the Free plan's limit.
  if (style.status !== StyleStatus.PUBLISHED) {
    await assertCanPublishStyle(shop);
  }

  await prisma.style.update({
    where: {
      id: style.id,
    },

    data: {
      status: StyleStatus.PUBLISHING,
      publishError: null,
    },
  });

  try {
    const upserted = await upsertShopifyProduct(admin, style, requestUrl);

    // Persist the recovery anchor immediately. Everything after this
    // point may fail and be retried without ever creating another
    // product.
    await prisma.style.update({
      where: {
        id: style.id,
      },

      data: {
        shopifyProductId: upserted.productId,
        shopifyProductHandle: upserted.handle,

        productSettings: {
          ...jsonObject(style.productSettings),
          defaultVariantId: upserted.variantId,
        },
      },
    });

    await syncAttachedMedia(upserted.mediaAssignments);

    await publishProductToOnlineStore(admin, upserted.productId);

    // Best-effort — the Shopify product itself is already live at this
    // point; a pricing-sync failure here is logged and left for the
    // next Product options save (or a future republish) to retry
    // rather than failing an otherwise-successful publish.
    const pricingSync = await syncStylePricingToShopify(admin, shop);

    if (!pricingSync.ok) {
      console.error(
        `Could not sync Shopify pricing for shop ${shop} after publishing style ${style.id}: ${pricingSync.message}`,
      );
    }

    // updatedAt is set explicitly here, matching publishedAt exactly —
    // left to Prisma's own @updatedAt, it's computed independently and
    // ends up a few ms after publishedAt, which would make this Style
    // look like it always has changes pending immediately after every
    // publish/update.
    const publishedAt = new Date();

    await prisma.style.update({
      where: {
        id: style.id,
      },

      data: {
        status: StyleStatus.PUBLISHED,
        publishedAt,
        updatedAt: publishedAt,
        publishError: null,
      },
    });

    return {
      shopifyProductId: upserted.productId,
      shopifyProductHandle: upserted.handle,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Publishing failed unexpectedly.";

    await prisma.style.update({
      where: {
        id: style.id,
      },

      data: {
        status: StyleStatus.PUBLISH_ERROR,
        publishError: message,
      },
    });

    throw error;
  }
}

type PublishableUnpublishResponse = {
  data?: {
    publishableUnpublish?: {
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  };
  errors?: Array<{ message: string }>;
};

const PUBLISHABLE_UNPUBLISH_MUTATION = `#graphql
  mutation StyleUnpublishFromOnlineStore(
    $id: ID!
    $input: [PublicationInput!]!
  ) {
    publishableUnpublish(id: $id, input: $input) {
      userErrors {
        field
        message
      }
    }
  }
`;

type ProductUpdateStatusResponse = {
  data?: {
    productUpdate?: {
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  };
  errors?: Array<{ message: string }>;
};

const PRODUCT_UPDATE_STATUS_MUTATION = `#graphql
  mutation StyleProductUpdateStatus($input: ProductInput!) {
    productUpdate(input: $input) {
      userErrors {
        field
        message
      }
    }
  }
`;

async function setShopifyProductStatus(
  admin: AdminGraphqlClient,
  productId: string,
  status: "ACTIVE" | "DRAFT",
) {
  const response = await admin.graphql(PRODUCT_UPDATE_STATUS_MUTATION, {
    variables: {
      input: {
        id: productId,
        status,
      },
    },
  });

  const payload = (await response.json()) as ProductUpdateStatusResponse;

  assertNoGraphqlErrors(payload);

  const userErrors = payload.data?.productUpdate?.userErrors ?? [];

  if (userErrors.length > 0) {
    throw new Error(userErrors.map((error) => error.message).join(" "));
  }
}

/**
 * Removes a Style's Shopify product from the Online Store publication
 * and drops the product itself to Draft status — matching what a
 * merchant would expect "unpublish" to mean, not just storefront
 * visibility. The product is never deleted; republishing (via
 * upsertShopifyProduct, which always sets status back to ACTIVE)
 * reuses the same product.
 */
export async function unpublishStyleFromShopify(
  admin: AdminGraphqlClient,
  shop: string,
  styleId: string,
): Promise<void> {
  const style = await requireStyleForShop(shop, styleId);

  if (style.status !== StyleStatus.PUBLISHED) {
    throw new Error(
      `This Style cannot be unpublished while its status is ${style.status}.`,
    );
  }

  if (!style.shopifyProductId) {
    throw new Error("This Style has no linked Shopify product to unpublish.");
  }

  await prisma.style.update({
    where: {
      id: style.id,
    },

    data: {
      status: StyleStatus.UNPUBLISHING,
      publishError: null,
    },
  });

  try {
    const publicationId = await findOnlineStorePublicationId(admin);

    const response = await admin.graphql(PUBLISHABLE_UNPUBLISH_MUTATION, {
      variables: {
        id: style.shopifyProductId,
        input: [{ publicationId }],
      },
    });

    const payload = (await response.json()) as PublishableUnpublishResponse;

    assertNoGraphqlErrors(payload);

    const userErrors = payload.data?.publishableUnpublish?.userErrors ?? [];

    if (userErrors.length > 0) {
      throw new Error(userErrors.map((error) => error.message).join(" "));
    }

    await setShopifyProductStatus(admin, style.shopifyProductId, "DRAFT");

    await prisma.style.update({
      where: {
        id: style.id,
      },

      data: {
        status: StyleStatus.UNPUBLISHED,
        publishError: null,
      },
    });

    // Best-effort — drops this style out of the pricing config now
    // that it's no longer PUBLISHED (buildTrustedPricingConfig only
    // includes PUBLISHED styles), same reasoning as the publish path.
    const pricingSync = await syncStylePricingToShopify(admin, shop);

    if (!pricingSync.ok) {
      console.error(
        `Could not sync Shopify pricing for shop ${shop} after unpublishing style ${style.id}: ${pricingSync.message}`,
      );
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unpublishing failed unexpectedly.";

    // The product is presumed to still be published since the unpublish
    // call did not confirm otherwise — restore that status rather than
    // leaving the Style stuck in UNPUBLISHING.
    await prisma.style.update({
      where: {
        id: style.id,
      },

      data: {
        status: StyleStatus.PUBLISHED,
        publishError: message,
      },
    });

    throw error;
  }
}

const PRODUCT_DELETE_MUTATION = `#graphql
  mutation StyleProductDelete($input: ProductDeleteInput!) {
    productDelete(input: $input) {
      deletedProductId
      userErrors {
        field
        message
      }
    }
  }
`;

type ProductDeleteResponse = {
  data?: {
    productDelete?: {
      deletedProductId: string | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  };
  errors?: Array<{ message: string }>;
};

async function deleteShopifyProduct(
  admin: AdminGraphqlClient,
  productId: string,
) {
  const response = await admin.graphql(PRODUCT_DELETE_MUTATION, {
    variables: {
      input: { id: productId },
    },
  });

  const payload = (await response.json()) as ProductDeleteResponse;

  assertNoGraphqlErrors(payload);

  const userErrors = payload.data?.productDelete?.userErrors ?? [];

  // Already gone (deleted from the Shopify admin directly, for
  // example) reads as success here, not a failure — the end state the
  // merchant wants (no live product) is already true.
  const alreadyGone = userErrors.some((error) =>
    /could not find|does not exist|not found/i.test(error.message),
  );

  if (userErrors.length > 0 && !alreadyGone) {
    throw new Error(userErrors.map((error) => error.message).join(" "));
  }
}

const deletableWithCleanupStatuses = new Set<StyleStatus>([
  StyleStatus.DRAFT,
  StyleStatus.PUBLISH_ERROR,
  StyleStatus.UNPUBLISHED,
  StyleStatus.PUBLISHED,
]);

/**
 * Deletes a Style, and — unlike deleteStyleDraft in style.server.ts —
 * also deletes its linked Shopify product first if it's PUBLISHED.
 * "Delete this prompt" on a live one is expected to mean "delete the
 * product too," not leave an orphaned product behind with nothing in
 * the app pointing at it. PUBLISHING/UNPUBLISHING (a publish job
 * actively in flight) is still blocked, same as before.
 */
export async function deleteStyleAndShopifyProduct(
  admin: AdminGraphqlClient,
  shop: string,
  styleId: string,
): Promise<void> {
  const style = await requireStyleForShop(shop, styleId);

  if (!deletableWithCleanupStatuses.has(style.status)) {
    throw new Error(
      "This Style cannot be deleted while a publish or unpublish is in progress.",
    );
  }

  if (style.shopifyProductId) {
    try {
      await deleteShopifyProduct(admin, style.shopifyProductId);
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `Could not delete the linked Shopify product: ${error.message}`
          : "Could not delete the linked Shopify product.",
      );
    }
  }

  await prisma.style.delete({
    where: {
      id: style.id,
    },
  });
}

/**
 * Bulk version of deleteStyleAndShopifyProduct — deletes each selected
 * style's linked Shopify product (if any) before deleting its row.
 * Runs sequentially, not in parallel, to avoid hitting Shopify's
 * cost-based rate limiter with a burst of productDelete calls. A style
 * still mid-publish/unpublish, or whose product deletion fails, is
 * left in place and counted as skipped rather than failing the whole
 * batch or silently losing track of an orphaned product.
 */
export async function bulkDeleteStylesAndShopifyProducts(
  admin: AdminGraphqlClient,
  shop: string,
  styleIds: string[],
): Promise<{ deletedCount: number; skippedCount: number }> {
  const styles = await prisma.style.findMany({
    where: {
      shop,
      id: { in: styleIds },
    },

    select: {
      id: true,
      status: true,
      shopifyProductId: true,
    },
  });

  let deletedCount = 0;

  let skippedCount = 0;

  for (const style of styles) {
    if (!deletableWithCleanupStatuses.has(style.status)) {
      skippedCount += 1;

      continue;
    }

    if (style.shopifyProductId) {
      try {
        await deleteShopifyProduct(admin, style.shopifyProductId);
      } catch (error) {
        console.error(
          `Could not delete Shopify product for style ${style.id}`,
          error,
        );

        skippedCount += 1;

        continue;
      }
    }

    await prisma.style.delete({
      where: { id: style.id },
    });

    deletedCount += 1;
  }

  return { deletedCount, skippedCount };
}
