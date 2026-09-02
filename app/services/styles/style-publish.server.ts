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

// M5 — the Shopify Publish engine.
//
// This is the only place that creates or mutates the Shopify product for a
// Style. It is designed to be safely retried: the Shopify product ID is
// persisted the moment Shopify returns one, before any further step runs,
// so a later failure (media, publication) never causes a duplicate
// product on retry — the retry resumes against the existing product.

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
          nodes: Array<{
            id: string;
            selectedOptions: Array<{ name: string; value: string }>;
          }>;
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
        variants(first: 100) {
          nodes {
            id
            selectedOptions {
              name
              value
            }
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

// Persisted in Style.productSettings.sizeVariants — one entry per
// actual Shopify variant (not per Size option, since a size can now
// correspond to several variants, one per Framing choice). compositeKey
// joins every active axis's option id in a fixed order
// (`${sizeOptionId ?? "none"}::${framingOptionId ?? "none"}`), not
// label text — so renaming a size or framing option later renames the
// existing Shopify variant on next republish instead of deleting and
// recreating it (which would break any cart/checkout already holding
// the old variant id). label/scalePercent always come from the Size
// axis only (or "Default Title"/100 when there's no Size axis) — never
// the Framing axis — since that's the one contract the storefront
// depends on: which resolution to serve for whichever variant was
// picked. Framing never affects image resolution.
export type SizeVariantMapping = {
  compositeKey: string;
  variantId: string;
  numericVariantId: string;
  label: string;
  scalePercent: number;
  // The Framing axis value's own frameColor, if any — null means no
  // visual frame for this variant (e.g. a "No Frame" choice, or a style
  // with no Framing axis at all). Drives whether the storefront draws a
  // CSS border around the result image for whichever variant the
  // customer currently has selected.
  frameColor: string | null;
};

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

// One independent variant axis (Size or Framing). A combination is one
// value chosen from each currently-active axis; the cartesian product
// of all active axes' values is the full variant matrix Shopify needs.
type AxisValue = {
  optionId: string;
  label: string;
  priceContribution: number;
  // null = this option didn't set its own discount — combination logic
  // falls back to its priceContribution (no discount from this axis),
  // never to 0.
  compareAtContribution: number | null;
  // null = this axis never sets shipping (only Framing does).
  requiresShipping: boolean | null;
  // null = this axis never affects image resolution (only Size does).
  scalePercent: number | null;
  // null = this axis never carries a visual frame color (only Framing
  // does, and even then only when the merchant set one).
  frameColor: string | null;
};

type VariantAxis = {
  name: string;
  values: AxisValue[];
};

function cartesianProduct(
  axes: VariantAxis[],
): Array<Array<{ axisName: string; value: AxisValue }>> {
  return axes.reduce<Array<Array<{ axisName: string; value: AxisValue }>>>(
    (combinations, axis) =>
      combinations.flatMap((combination) =>
        axis.values.map((value) => [
          ...combination,
          { axisName: axis.name, value },
        ]),
      ),
    [[]],
  );
}

function compositeKeyFor(
  combination: Array<{ axisName: string; value: AxisValue }>,
): string {
  const sizeId =
    combination.find((entry) => entry.axisName === "Size")?.value.optionId ??
    "none";

  const framingId =
    combination.find((entry) => entry.axisName === "Framing")?.value
      .optionId ?? "none";

  return `${sizeId}::${framingId}`;
}

/**
 * Reads back the sizeVariants a previous publish stored in
 * Style.productSettings — used by the app-proxy routes to tell the
 * storefront which Shopify variant id maps to which print size, and to
 * build a signed result-image URL per size.
 */
export function parseSizeVariants(productSettings: unknown): SizeVariantMapping[] {
  if (typeof productSettings !== "object" || productSettings === null) {
    return [];
  }

  const sizeVariants = (productSettings as Record<string, unknown>).sizeVariants;

  if (!Array.isArray(sizeVariants)) {
    return [];
  }

  return sizeVariants
    .filter(
      (entry): entry is SizeVariantMapping =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as SizeVariantMapping).numericVariantId === "string" &&
        typeof (entry as SizeVariantMapping).label === "string" &&
        typeof (entry as SizeVariantMapping).scalePercent === "number",
    )
    // Entries persisted by a publish before this field existed simply
    // won't have it — normalized to null rather than left undefined.
    .map((entry) => ({
      ...entry,
      frameColor:
        typeof entry.frameColor === "string" ? entry.frameColor : null,
    }));
}

type UpsertResult = {
  productId: string;
  handle: string;
  sizeVariants: SizeVariantMapping[];
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

  // Per-style, opt-in — every axis a merchant hasn't configured on the
  // Product tab is simply absent, and an empty axis list (the common
  // case, and every style before this feature existed) publishes as
  // the original single "Default Title" variant, exactly as before.
  const axes: VariantAxis[] = [];

  if (style.sizeOptions.length > 0) {
    axes.push({
      name: "Size",
      values: style.sizeOptions.map((option) => ({
        optionId: option.id,
        label: option.label,
        priceContribution: Number(option.price),
        compareAtContribution: option.compareAtPrice
          ? Number(option.compareAtPrice)
          : null,
        requiresShipping: null,
        scalePercent: option.scalePercent,
        frameColor: null,
      })),
    });
  }

  if (style.framingOptions.length > 0) {
    axes.push({
      name: "Framing",
      values: style.framingOptions.map((option) => ({
        optionId: option.id,
        label: option.label,
        priceContribution: Number(option.priceDelta),
        compareAtContribution: option.compareAtPriceDelta
          ? Number(option.compareAtPriceDelta)
          : null,
        requiresShipping: option.requiresShipping,
        scalePercent: null,
        frameColor: option.frameColor,
      })),
    });
  }

  const hasAxes = axes.length > 0;

  const combinations = cartesianProduct(axes);

  const existingSizeVariants = Array.isArray(productSettings.sizeVariants)
    ? (productSettings.sizeVariants as unknown[]).filter(
        (entry): entry is SizeVariantMapping =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as SizeVariantMapping).compositeKey === "string" &&
          typeof (entry as SizeVariantMapping).variantId === "string",
      )
    : [];

  const existingVariantIdByCompositeKey = new Map(
    existingSizeVariants.map((entry) => [entry.compositeKey, entry.variantId]),
  );

  // Legacy path — the single variant a no-axes product already has
  // from before this feature (or still has, if it never opted in).
  const legacyVariantId =
    typeof productSettings.defaultVariantId === "string"
      ? productSettings.defaultVariantId
      : (existingVariantIdByCompositeKey.get("none::none") ?? null);

  // Already-attached assets are normally referenced by their known
  // Shopify media ID (kept as-is), and new ones submitted by URL —
  // except when recreating the product from scratch (see below), where
  // every known id belongs to the now-deleted product and is useless,
  // so everything must go through the URL path to be freshly attached
  // to the new one.
  function buildInput(options: {
    forceRecreate: boolean;
    forceReuploadMedia?: boolean;
    staleVariantIds?: Set<string>;
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

      // One Shopify product option per active axis (Size, Framing) —
      // or, if neither is configured, Shopify's own "Title"/"Default
      // Title" convention for a plain single-variant product
      // (productSet still requires an explicit option/optionValues
      // even for that simple case).
      productOptions: hasAxes
        ? axes.map((axis) => ({
            name: axis.name,
            values: axis.values.map((value) => ({ name: value.label })),
          }))
        : [{ name: "Title", values: [{ name: "Default Title" }] }],

      variants: hasAxes
        ? combinations.map((combination) => {
            const compositeKey = compositeKeyFor(combination);

            const rawExistingVariantId = options.forceRecreate
              ? null
              : (existingVariantIdByCompositeKey.get(compositeKey) ?? null);

            // Dropped only for ids Shopify just told us are stale (see
            // the staleVariantIds retry below) — every other existing
            // variant must keep its id so it updates in place instead
            // of being recreated as a duplicate.
            const existingVariantId =
              rawExistingVariantId &&
              options.staleVariantIds?.has(numericIdFromGid(rawExistingVariantId))
                ? null
                : rawExistingVariantId;

            const sizeValue =
              combination.find((entry) => entry.axisName === "Size")
                ?.value ?? null;

            const framingValue =
              combination.find((entry) => entry.axisName === "Framing")
                ?.value ?? null;

            // Size contributes the base price (or the Style's flat
            // basePrice if there's no Size axis at all); Framing is
            // always an add-on delta on top of that.
            const basePrice = sizeValue
              ? sizeValue.priceContribution
              : Number(style.basePrice);

            const price = basePrice + (framingValue?.priceContribution ?? 0);

            // A missing compareAt/delta on a *present* axis means "no
            // discount from that axis" (falls back to its own price
            // contribution), not 0 — summing zeros would produce a
            // compareAtPrice below the actual price, which Shopify
            // rejects. An axis that's absent entirely contributes
            // nothing either way.
            const sizeCompareAtBase = sizeValue
              ? (sizeValue.compareAtContribution ?? sizeValue.priceContribution)
              : style.compareAtPrice
                ? Number(style.compareAtPrice)
                : Number(style.basePrice);

            const framingCompareAtDelta = framingValue
              ? (framingValue.compareAtContribution ??
                  framingValue.priceContribution)
              : 0;

            const combinedCompareAt =
              sizeCompareAtBase + framingCompareAtDelta;

            const compareAtPrice =
              combinedCompareAt > price ? combinedCompareAt.toFixed(2) : null;

            return {
              ...(existingVariantId ? { id: existingVariantId } : {}),
              price: price.toFixed(2),
              compareAtPrice,
              optionValues: combination.map((entry) => ({
                optionName: entry.axisName,
                name: entry.value.label,
              })),
              // Made to order from the customer's own upload — there's
              // no real stock to run out of, on any size/framing
              // combination, so every variant always stays purchasable
              // regardless of on-hand quantity (inventoryPolicy
              // CONTINUE). Inventory itself stays tracked (not
              // tracked: false) so the merchant still gets normal
              // sold-count reporting — CONTINUE is what keeps it from
              // ever actually blocking a sale, not disabling tracking.
              // Only Framing ever makes a variant a real physical
              // product — everything else in this app is digital.
              inventoryItem: {
                tracked: true,
                requiresShipping: framingValue?.requiresShipping ?? false,
              },
              inventoryPolicy: "CONTINUE",
            };
          })
        : [
            {
              ...(!options.forceRecreate && legacyVariantId
                ? { id: legacyVariantId }
                : {}),
              price: style.basePrice.toString(),
              compareAtPrice: style.compareAtPrice
                ? style.compareAtPrice.toString()
                : null,
              optionValues: [{ optionName: "Title", name: "Default Title" }],
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

  // A previously-attached variant's id can also go stale, the same way
  // media ids can — most commonly because it was deleted directly in
  // Shopify admin, or left over from an earlier publish that failed
  // after Shopify's own side had already dropped it. Unlike media,
  // most of the OTHER existing variants are still perfectly valid and
  // must keep their id (dropping every id would recreate duplicates
  // for every combination, not just the stale ones) — so only the
  // specific stale id(s) Shopify names in the error are cleared before
  // retrying once.
  const staleVariantIds = extractStaleVariantIds(
    payload.data?.productSet?.userErrors ?? [],
  );

  if (staleVariantIds.size > 0) {
    ({ input, knownAssets, newAssets } = buildInput({
      forceRecreate: false,
      staleVariantIds,
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

  // The legacy single-variant path is still represented as a one-entry
  // sizeVariants list (a synthetic "default" key, scalePercent 100) so
  // every downstream consumer (app-proxy routes, storefront JS) can
  // treat "has sizes" and "doesn't" identically — there's always at
  // least one size to resolve a result-image URL against.
  const sizeVariants: SizeVariantMapping[] = hasAxes
    ? combinations
        .map((combination) => {
          const compositeKey = compositeKeyFor(combination);

          // Every axis in this combination must match — with two axes,
          // several variant nodes share the same Size value (one per
          // Framing choice), so checking only one axis (.some() alone)
          // can grab the wrong node. Every expected {name, value} pair
          // must be present on the node's selectedOptions.
          const expectedOptions = combination.map((entry) => ({
            name: entry.axisName,
            value: entry.value.label,
          }));

          const matchingNode = product.variants.nodes.find((node) =>
            expectedOptions.every((expected) =>
              node.selectedOptions.some(
                (selected) =>
                  selected.name === expected.name &&
                  selected.value === expected.value,
              ),
            ),
          );

          const variantId =
            matchingNode?.id ?? existingVariantIdByCompositeKey.get(compositeKey);

          if (!variantId) {
            return null;
          }

          // label/scalePercent always come from the Size axis only —
          // Framing never affects which image resolution to serve.
          const sizeValue =
            combination.find((entry) => entry.axisName === "Size")?.value ??
            null;

          const framingValue =
            combination.find((entry) => entry.axisName === "Framing")
              ?.value ?? null;

          return {
            compositeKey,
            variantId,
            numericVariantId: numericIdFromGid(variantId),
            label: sizeValue ? sizeValue.label : "Default Title",
            scalePercent: sizeValue?.scalePercent ?? 100,
            frameColor: framingValue?.frameColor ?? null,
          };
        })
        .filter((entry): entry is SizeVariantMapping => entry !== null)
    : (() => {
        const variantId = product.variants.nodes[0]?.id ?? legacyVariantId;

        if (!variantId) {
          return [];
        }

        return [
          {
            compositeKey: "none::none",
            variantId,
            numericVariantId: numericIdFromGid(variantId),
            label: "Default Title",
            scalePercent: 100,
            frameColor: null,
          },
        ];
      })();

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
    sizeVariants,
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
          sizeVariants: upserted.sizeVariants,
        },
      },
    });

    await syncAttachedMedia(upserted.mediaAssignments);

    await publishProductToOnlineStore(admin, upserted.productId);

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
