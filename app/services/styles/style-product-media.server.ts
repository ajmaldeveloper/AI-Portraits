import { createHash } from "node:crypto";

import { GenerationPurpose, Prisma, StyleAssetKind } from "@prisma/client";

import prisma from "../../db.server";
import { FluxImageError, generateFluxImages } from "../ai/flux-image.server";
import {
  assertCanGenerate,
  recordGenerationUsage,
} from "../billing/billing.server";
import {
  GoogleImageError,
  generateGoogleImages,
} from "../ai/google-image.server";
import {
  OpenAIImageError,
  generateOpenAIImages,
} from "../ai/openai-image.server";
import {
  outputQuality,
  outputSize,
  pngDimensions,
  toDatabaseBytes,
} from "../ai/image-output.server";
import {
  createGenerationLedgerEntry,
  markGenerationFailed,
  markGenerationProcessing,
  markGenerationSucceeded,
} from "../generations/generation.server";
import { getDecryptedAIProviderCredentials } from "../settings/ai-provider-settings.server";
import { requireStyleForShop, styleMediaCanBeEdited } from "./style.server";

const MAX_STYLE_PRODUCT_IMAGES = 12;

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const ACCEPTED_UPLOAD_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export function productExamplePrompt(input: {
  styleName: string;
  productTitle: string;
  transformationPrompt: string;
}) {
  return `
Create a polished ecommerce product example image that demonstrates the following configurable AI artwork style.

Style name:
${input.styleName}

Shopify product:
${input.productTitle}

Merchant transformation instructions:
${input.transformationPrompt}

Important instructions for this product example:
- There is no customer upload in this request, so choose a suitable generic subject that clearly demonstrates the configured transformation.
- Produce the finished artwork itself, not an app interface.
- Make the result premium and commercially presentable for a Shopify product gallery.
- Do not create a before-and-after split image.
- Do not add watermarks, logos, UI controls, pricing, badges, mock browser windows, or promotional labels.
- Do not invent customer-specific names, addresses, dates, or other readable personalized text.
- Do not add a frame, mat, room mockup, or product packaging unless the merchant transformation instructions explicitly require that visual treatment.
- The output should make it immediately clear what type of artwork a customer can expect after uploading their own image.

Follow the merchant transformation instructions as the primary visual direction.
  `.trim();
}

async function persistGeneratedImages(input: {
  styleId: string;
  generationId: string;
  styleName: string;

  images: Array<{
    bytes: Uint8Array;
  }>;
}) {
  const aggregate = await prisma.styleAsset.aggregate({
    where: {
      styleId: input.styleId,
    },

    _max: {
      position: true,
    },
  });

  const startPosition = (aggregate._max.position ?? -1) + 1;

  return prisma.$transaction(
    input.images.map((image, index) => {
      const dimensions = pngDimensions(image.bytes);

      return prisma.styleAsset.create({
        data: {
          styleId: input.styleId,

          generationId: input.generationId,

          kind: StyleAssetKind.PRODUCT_GENERATED,

          mimeType: "image/png",

          width: dimensions.width,

          height: dimensions.height,

          altText: `Generated example for ${input.styleName}`,

          position: startPosition + index,

          binaryData: toDatabaseBytes(image.bytes),
        },
      });
    }),
  );
}

export async function generateStyleProductImages(
  shop: string,
  styleId: string,
  options?: { promptOverride?: string },
) {
  const style = await requireStyleForShop(shop, styleId);

  if (!styleMediaCanBeEdited(style)) {
    throw new Error(
      "Product images cannot be generated while this Style is locked.",
    );
  }

  const existingCount = await prisma.styleAsset.count({
    where: {
      styleId: style.id,

      kind: {
        in: [StyleAssetKind.PRODUCT_GENERATED, StyleAssetKind.PRODUCT_SELECTED],
      },
    },
  });

  const remaining = MAX_STYLE_PRODUCT_IMAGES - existingCount;

  if (remaining <= 0) {
    throw new Error(
      `This Style already has ${MAX_STYLE_PRODUCT_IMAGES} product images. Delete an image before generating more.`,
    );
  }

  const count = Math.min(Math.max(style.previewCount, 1), 4, remaining);

  // The app never supplies its own AI credentials — every shop brings
  // its own provider and key, configured from Settings.
  const credentials = await getDecryptedAIProviderCredentials(shop);

  if (!credentials) {
    throw new Error(
      "Configure an AI provider and API key in Settings before generating images.",
    );
  }

  // The Style's own prompt (edited on the Style tab) drives the real
  // customer-facing transformation and is left untouched here. This is
  // a separate, ephemeral prompt for generating storefront preview
  // images — reviewable and editable per generation, defaulting to a
  // template built from the Style's prompt but never written back to
  // it.
  const prompt =
    options?.promptOverride?.trim() ||
    productExamplePrompt({
      styleName: style.name,

      productTitle: style.productTitle,

      transformationPrompt: style.prompt,
    });

  if (!prompt) {
    throw new Error(
      "Add a generation prompt before generating product images.",
    );
  }

  const { isPro } = await assertCanGenerate(shop, count);

  const generation = await createGenerationLedgerEntry({
    shop,

    styleId: style.id,

    purpose: GenerationPurpose.STYLE_PRODUCT,

    provider: credentials.provider,

    model: credentials.model,

    prompt,

    inputPayload: {
      count,

      aspectRatio: style.outputAspectRatio,

      quality: style.outputQuality,
    },
  });

  await markGenerationProcessing(shop, generation.id);

  try {
    const quality = outputQuality(style.outputQuality);

    const result =
      credentials.provider === "google"
        ? await generateGoogleImages({
            apiKey: credentials.apiKey,
            model: credentials.model,
            prompt,
            count,
            aspectRatio: style.outputAspectRatio,
            quality,
          })
        : credentials.provider === "flux"
          ? await generateFluxImages({
              apiKey: credentials.apiKey,
              model: credentials.model,
              prompt,
              count,
              aspectRatio: style.outputAspectRatio,
            })
          : await generateOpenAIImages({
              apiKey: credentials.apiKey,
              model: credentials.model,
              prompt,
              count,
              size: outputSize(style.outputAspectRatio),
              quality,
              user: shop,
            });

    const assets = await persistGeneratedImages({
      styleId: style.id,

      generationId: generation.id,

      styleName: style.name,

      images: result.images,
    });

    // Not awaited — billing must never add latency to the merchant's
    // response, and recordGenerationUsage already swallows its own
    // errors. One usage record per image, matching how the Free plan's
    // limit is counted (see countGenerationsThisMonth).
    if (isPro) {
      void (async () => {
        for (const asset of assets) {
          await recordGenerationUsage(
            shop,
            `AI image generation for "${style.name}" (asset ${asset.id})`,
          );
        }
      })();
    }

    /*
     * Prisma InputJsonObject is readonly.
     *
     * Build the entire JSON object in one expression instead of assigning
     * requestId/created afterward.
     */
    const outputPayload: Prisma.InputJsonObject = {
      model: result.model,

      assetIds: assets.map((asset) => asset.id),

      revisedPrompts: result.images
        .map((image) => image.revisedPrompt)
        .filter((value): value is string => Boolean(value)),

      ...(result.requestId
        ? {
            requestId: result.requestId,
          }
        : {}),
    };

    await markGenerationSucceeded(shop, generation.id, {
      outputPayload,
    });

    return {
      generationId: generation.id,

      count: assets.length,

      assets,
    };
  } catch (error) {
    const errorCode =
      error instanceof OpenAIImageError ||
      error instanceof GoogleImageError ||
      error instanceof FluxImageError
        ? error.code
        : "generation_failed";

    const message =
      error instanceof Error ? error.message : "Image generation failed.";

    try {
      await markGenerationFailed(shop, generation.id, {
        errorCode,
        errorMessage: message,
      });
    } catch {
      // Preserve the original provider error.
    }

    throw error;
  }
}

export function hashImageBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Content hashes of every image already in this Style's gallery, so a
 * caller can check a newly selected file against them before uploading
 * — an identical re-upload (same device file picked twice, or the same
 * Shopify File imported again) would otherwise silently create a
 * second, indistinguishable gallery entry.
 */
export async function getStyleImageContentHashes(
  shop: string,
  styleId: string,
): Promise<Set<string>> {
  const style = await requireStyleForShop(shop, styleId);

  const assets = await prisma.styleAsset.findMany({
    where: {
      styleId: style.id,

      kind: {
        in: [StyleAssetKind.PRODUCT_GENERATED, StyleAssetKind.PRODUCT_SELECTED],
      },

      binaryData: {
        not: null,
      },
    },

    select: {
      binaryData: true,
    },
  });

  const hashes = new Set<string>();

  for (const asset of assets) {
    if (asset.binaryData) {
      hashes.add(hashImageBytes(asset.binaryData));
    }
  }

  return hashes;
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

/**
 * Remembers which "How do you want to add images?" panel a merchant last
 * used, so it doesn't reset to "Generate with AI" every time they revisit
 * this Style. Stored server-side (not localStorage) so it isn't lost to
 * browser storage being per-origin — relevant since local dev runs behind
 * an ephemeral tunnel hostname that changes on every restart.
 */
export async function setStyleMediaMode(
  shop: string,
  styleId: string,
  mode: "generate" | "upload",
) {
  const style = await requireStyleForShop(shop, styleId);

  await prisma.style.update({
    where: {
      id: style.id,
    },

    data: {
      productSettings: {
        ...jsonObject(style.productSettings),
        mediaMode: mode,
      },
    },
  });
}

/**
 * Attaches a Shopify Files media id to an already-created asset. Used
 * for the background sync after an upload — the asset is saved and
 * shown in the gallery immediately, and this fills in the durable
 * Shopify reference once the (slower) Files upload finishes, without
 * making the merchant wait for it.
 */
export async function attachStyleAssetShopifyMediaId(
  assetId: string,
  shopifyMediaId: string,
) {
  await prisma.styleAsset.updateMany({
    where: {
      id: assetId,
    },

    data: {
      shopifyMediaId,
    },
  });
}

export async function uploadStyleProductImages(
  shop: string,
  styleId: string,
  files: Array<{
    bytes: Uint8Array;
    mimeType: string;
    shopifyMediaId?: string | null;
  }>,
) {
  const style = await requireStyleForShop(shop, styleId);

  if (!styleMediaCanBeEdited(style)) {
    throw new Error(
      "Product images cannot be uploaded while this Style is locked.",
    );
  }

  if (files.length === 0) {
    throw new Error("Choose at least one image to upload.");
  }

  for (const file of files) {
    if (!ACCEPTED_UPLOAD_MIME_TYPES.has(file.mimeType)) {
      throw new Error("Only PNG, JPEG, WEBP, or GIF images can be uploaded.");
    }

    if (file.bytes.byteLength === 0) {
      throw new Error("One of the uploaded files is empty.");
    }

    if (file.bytes.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error("Each uploaded image must be 10MB or smaller.");
    }
  }

  const existingCount = await prisma.styleAsset.count({
    where: {
      styleId: style.id,

      kind: {
        in: [StyleAssetKind.PRODUCT_GENERATED, StyleAssetKind.PRODUCT_SELECTED],
      },
    },
  });

  const remaining = MAX_STYLE_PRODUCT_IMAGES - existingCount;

  if (remaining <= 0) {
    throw new Error(
      `This Style already has ${MAX_STYLE_PRODUCT_IMAGES} product images. Delete an image before uploading more.`,
    );
  }

  const filesToUpload = files.slice(0, remaining);

  const aggregate = await prisma.styleAsset.aggregate({
    where: {
      styleId: style.id,
    },

    _max: {
      position: true,
    },
  });

  const startPosition = (aggregate._max.position ?? -1) + 1;

  return prisma.$transaction(
    filesToUpload.map((file, index) => {
      const dimensions = pngDimensions(file.bytes);

      return prisma.styleAsset.create({
        data: {
          styleId: style.id,

          generationId: null,

          // Lands unselected, same as an AI-generated candidate — the
          // merchant checks the box explicitly to choose which image(s)
          // are actually used on the product.
          kind: StyleAssetKind.PRODUCT_GENERATED,

          mimeType: file.mimeType,

          width: dimensions.width,

          height: dimensions.height,

          altText: `Uploaded image for ${style.name}`,

          position: startPosition + index,

          binaryData: toDatabaseBytes(file.bytes),

          shopifyMediaId: file.shopifyMediaId || null,
        },
      });
    }),
  );
}

/**
 * Every image in the gallery IS the product's media — there's no
 * separate "select this one for the product" step. Checking an image's
 * box only marks it for bulk removal from the gallery, which is why
 * this takes an explicit list of ids from the client rather than
 * reading a persisted "selected" flag: nothing about which box is
 * checked is ever written to the database until Remove is pressed.
 */
// A single frame-texture image for an IMAGE_SWATCH-type StyleOption
// choice — a separate, dedicated pool from the product photo gallery
// (kind FRAME_TEXTURE, not PRODUCT_GENERATED/PRODUCT_SELECTED), so it
// doesn't count against MAX_STYLE_PRODUCT_IMAGES and never shows up in
// the Media tab's gallery. Lands immediately usable (no "select this
// one" step, unlike a product photo) — the merchant picks the file
// directly in the choice's own Add/Edit modal.
export async function uploadStyleFrameTexture(
  shop: string,
  styleId: string,
  file: { bytes: Uint8Array; mimeType: string },
) {
  const style = await requireStyleForShop(shop, styleId);

  if (!styleMediaCanBeEdited(style)) {
    throw new Error(
      "Frame textures cannot be uploaded while this Style is locked.",
    );
  }

  if (!ACCEPTED_UPLOAD_MIME_TYPES.has(file.mimeType)) {
    throw new Error("Only PNG, JPEG, WEBP, or GIF images can be uploaded.");
  }

  if (file.bytes.byteLength === 0) {
    throw new Error("The uploaded file is empty.");
  }

  if (file.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error("The uploaded image must be 10MB or smaller.");
  }

  const dimensions = pngDimensions(file.bytes);

  return prisma.styleAsset.create({
    data: {
      styleId: style.id,
      generationId: null,
      kind: StyleAssetKind.FRAME_TEXTURE,
      mimeType: file.mimeType,
      width: dimensions.width,
      height: dimensions.height,
      altText: `Frame texture for ${style.name}`,
      position: 0,
      binaryData: toDatabaseBytes(file.bytes),
    },
  });
}

export async function deleteStyleProductImages(
  shop: string,
  styleId: string,
  assetIds: string[],
) {
  const style = await requireStyleForShop(shop, styleId);

  if (!styleMediaCanBeEdited(style)) {
    throw new Error(
      "Product media cannot be changed while this Style is locked.",
    );
  }

  if (assetIds.length === 0) {
    return 0;
  }

  const result = await prisma.styleAsset.deleteMany({
    where: {
      styleId: style.id,
      id: { in: assetIds },
    },
  });

  return result.count;
}

export async function getStyleAssetBinary(shop: string, assetId: string) {
  const asset = await prisma.styleAsset.findFirst({
    where: {
      id: assetId,

      style: {
        shop,
      },
    },

    select: {
      id: true,
      mimeType: true,
      binaryData: true,
      updatedAt: true,
    },
  });

  if (!asset) {
    return null;
  }

  const binaryData = asset.binaryData;

  if (!binaryData) {
    return null;
  }

  /*
   * Return a new object after narrowing binaryData.
   *
   * This prevents TypeScript from widening binaryData back to
   * Uint8Array | null at the route call site.
   */
  return {
    id: asset.id,

    mimeType: asset.mimeType,

    binaryData: toDatabaseBytes(binaryData),

    updatedAt: asset.updatedAt,
  };
}
