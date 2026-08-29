import {
  GenerationPurpose,
  GenerationStatus,
  StyleAssetKind,
} from "@prisma/client";

import prisma from "../../db.server";
import {
  outputQuality,
  outputSize,
  pngDimensions,
  toDatabaseBytes,
} from "../ai/image-output.server";
import { OpenAIImageError, editOpenAIImage } from "../ai/openai-image.server";
import {
  PlanLimitError,
  assertCanGenerate,
  recordGenerationUsage,
} from "../billing/billing.server";
import {
  createGenerationLedgerEntry,
  markGenerationFailed,
  markGenerationProcessing,
  markGenerationSucceeded,
} from "../generations/generation.server";
import { getDecryptedAIProviderCredentials } from "../settings/ai-provider-settings.server";
import { requireStyleForShop } from "../styles/style.server";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const ACCEPTED_UPLOAD_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export class CustomerGenerationError extends Error {}

/**
 * Builds the final prompt sent to the AI provider for a customer's own
 * photo: the Style's transformation instructions, plus whatever the
 * customer answered in any non-image customer fields (each field's
 * label is included so the AI has readable context, not just raw
 * values), plus an optional freeform personalization note the customer
 * typed next to the photo upload (e.g. "add a crown").
 */
function buildCustomerPrompt(
  style: { prompt: string },
  fields: Array<{ key: string; label: string; type: string }>,
  fieldValues: Record<string, string>,
  personalization: string,
): string {
  const answeredContext = fields
    .filter((field) => field.type !== "IMAGE")
    .map((field) => {
      const value = fieldValues[field.key]?.trim();

      return value ? `${field.label}: ${value}` : null;
    })
    .filter((line): line is string => Boolean(line));

  const trimmedPersonalization = personalization.trim();

  if (trimmedPersonalization) {
    answeredContext.push(
      `Customer's personalization request: ${trimmedPersonalization}`,
    );
  }

  if (answeredContext.length === 0) {
    return style.prompt;
  }

  return `${style.prompt}\n\nAdditional context from the customer:\n${answeredContext.join("\n")}`;
}

export type StartCustomerGenerationInput = {
  photo: {
    bytes: Uint8Array;
    mimeType: string;
  };

  // Keyed by StyleField.key, excluding the IMAGE field (that's `photo`
  // above).
  fieldValues: Record<string, string>;

  // A freeform, always-available optional note the customer can type
  // next to the photo upload (e.g. "add a crown") — distinct from the
  // merchant-defined fields above, and not tied to any Style config.
  personalization?: string;
};

export async function startCustomerGeneration(
  shop: string,
  styleId: string,
  input: StartCustomerGenerationInput,
): Promise<{ generationId: string }> {
  const style = await requireStyleForShop(shop, styleId);

  if (style.status !== "PUBLISHED") {
    throw new CustomerGenerationError(
      "This product isn't available for personalization right now.",
    );
  }

  if (!ACCEPTED_UPLOAD_MIME_TYPES.has(input.photo.mimeType)) {
    throw new CustomerGenerationError(
      "Photo must be a PNG, JPEG, or WEBP image.",
    );
  }

  if (input.photo.bytes.byteLength === 0) {
    throw new CustomerGenerationError("Choose a photo to upload.");
  }

  if (input.photo.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new CustomerGenerationError("Photo must be 10MB or smaller.");
  }

  for (const field of style.fields) {
    if (field.type === "IMAGE") {
      continue;
    }

    if (field.required && !input.fieldValues[field.key]?.trim()) {
      throw new CustomerGenerationError(`${field.label} is required.`);
    }
  }

  const credentials = await getDecryptedAIProviderCredentials(shop);

  if (!credentials) {
    throw new CustomerGenerationError(
      "This shop hasn't configured AI image generation yet.",
    );
  }

  // Only OpenAI supports editing an uploaded photo today — Google and
  // Flux only have the text-to-image path used for storefront
  // examples. Extending those is tracked separately.
  if (credentials.provider !== "openai") {
    throw new CustomerGenerationError(
      "This shop's configured AI provider doesn't support photo personalization yet.",
    );
  }

  let isPro: boolean;

  try {
    ({ isPro } = await assertCanGenerate(shop));
  } catch (error) {
    if (error instanceof PlanLimitError) {
      throw new CustomerGenerationError(
        "This shop has reached its monthly personalization limit. Please try again next month.",
      );
    }

    throw error;
  }

  const prompt = buildCustomerPrompt(
    style,
    style.fields,
    input.fieldValues,
    input.personalization ?? "",
  );

  const generation = await createGenerationLedgerEntry({
    shop,
    styleId: style.id,
    purpose: GenerationPurpose.CUSTOMER_FINAL,
    provider: credentials.provider,
    model: credentials.model,
    prompt,
    inputPayload: {
      fieldValues: input.fieldValues,
      personalization: input.personalization?.trim() || null,
    },
  });

  await prisma.styleAsset.create({
    data: {
      styleId: style.id,
      generationId: generation.id,
      kind: StyleAssetKind.CUSTOMER_UPLOAD,
      mimeType: input.photo.mimeType,
      altText: `Customer upload for ${style.name}`,
      binaryData: toDatabaseBytes(input.photo.bytes),
    },
  });

  // Not awaited — the initial request returns immediately with a
  // generation id the storefront polls, rather than holding the
  // connection open for the 10-30+ seconds a real edit call can take.
  void runCustomerGeneration({
    shop,
    generationId: generation.id,
    styleId: style.id,
    styleName: style.name,
    aspectRatio: style.outputAspectRatio,
    quality: style.outputQuality,
    apiKey: credentials.apiKey,
    model: credentials.model,
    prompt,
    photo: input.photo,
    isPro,
  });

  return { generationId: generation.id };
}

async function runCustomerGeneration(input: {
  shop: string;
  generationId: string;
  styleId: string;
  styleName: string;
  aspectRatio: string;
  quality: string;
  apiKey: string;
  model: string | null;
  prompt: string;
  photo: { bytes: Uint8Array; mimeType: string };
  isPro: boolean;
}) {
  try {
    await markGenerationProcessing(input.shop, input.generationId);

    const result = await editOpenAIImage({
      apiKey: input.apiKey,
      model: input.model || "gpt-image-2",
      prompt: input.prompt,
      size: outputSize(input.aspectRatio),
      quality: outputQuality(input.quality),
      image: input.photo,
    });

    const dimensions = pngDimensions(result.image.bytes);

    await prisma.styleAsset.create({
      data: {
        styleId: input.styleId,
        generationId: input.generationId,
        kind: StyleAssetKind.CUSTOMER_RESULT,
        mimeType: "image/png",
        width: dimensions.width,
        height: dimensions.height,
        altText: `Personalized result for ${input.styleName}`,
        binaryData: toDatabaseBytes(result.image.bytes),
      },
    });

    await markGenerationSucceeded(input.shop, input.generationId, {
      outputPayload: {
        requestId: result.requestId,
        revisedPrompt: result.image.revisedPrompt,
      },
    });

    if (input.isPro) {
      await recordGenerationUsage(
        input.shop,
        `AI image generation for "${input.styleName}" (customer order)`,
      );
    }
  } catch (error) {
    const message =
      error instanceof OpenAIImageError || error instanceof Error
        ? error.message
        : "Image generation failed unexpectedly.";

    const errorCode =
      error instanceof OpenAIImageError ? error.code : "generation_failed";

    try {
      await markGenerationFailed(input.shop, input.generationId, {
        errorCode,
        errorMessage: message,
      });
    } catch (markError) {
      console.error("Could not record customer generation failure", markError);
    }
  }
}

export type CustomerGenerationStatus = {
  status: GenerationStatus;
  errorMessage: string | null;
  resultAssetId: string | null;
  styleId: string;
};

export async function getCustomerGenerationStatus(
  shop: string,
  generationId: string,
): Promise<CustomerGenerationStatus | null> {
  const generation = await prisma.generation.findFirst({
    where: {
      id: generationId,
      shop,
      purpose: GenerationPurpose.CUSTOMER_FINAL,
    },

    select: {
      status: true,
      errorMessage: true,
      styleId: true,

      assets: {
        where: {
          kind: StyleAssetKind.CUSTOMER_RESULT,
        },

        select: {
          id: true,
        },

        take: 1,
      },
    },
  });

  if (!generation) {
    return null;
  }

  return {
    status: generation.status,
    errorMessage: generation.errorMessage,
    resultAssetId: generation.assets[0]?.id ?? null,
    styleId: generation.styleId,
  };
}
