import { GenerationPurpose, GenerationStatus, Prisma } from "@prisma/client";

import prisma from "../../db.server";
import { requireStyleForShop } from "../styles/style.server";

export type CreateGenerationInput = {
  shop: string;
  styleId: string;
  purpose: GenerationPurpose;
  provider: string;
  model?: string | null;
  prompt: string;
  inputPayload?: Prisma.InputJsonValue;
  customerId?: string | null;
};

async function requireGenerationForShop(shop: string, generationId: string) {
  const generation = await prisma.generation.findFirst({
    where: {
      id: generationId,
      shop,
    },
  });

  if (!generation) {
    throw new Response("Generation not found", {
      status: 404,
    });
  }

  return generation;
}

export async function createGenerationLedgerEntry(
  input: CreateGenerationInput,
) {
  const shop = input.shop.trim();

  if (!shop) {
    throw new Error("Shop is required.");
  }

  const provider = input.provider.trim();

  if (!provider) {
    throw new Error("AI provider is required.");
  }

  await requireStyleForShop(shop, input.styleId);

  return prisma.generation.create({
    data: {
      shop,
      styleId: input.styleId,
      purpose: input.purpose,
      status: GenerationStatus.QUEUED,
      provider,
      model: input.model?.trim() || null,
      prompt: input.prompt,
      customerId: input.customerId || null,
      ...(input.inputPayload === undefined
        ? {}
        : { inputPayload: input.inputPayload }),
    },
  });
}

export async function markGenerationProcessing(
  shop: string,
  generationId: string,
  providerRequestId?: string | null,
) {
  const generation = await requireGenerationForShop(shop, generationId);

  return prisma.generation.update({
    where: {
      id: generation.id,
    },
    data: {
      status: GenerationStatus.PROCESSING,
      startedAt: generation.startedAt ?? new Date(),
      providerRequestId: providerRequestId?.trim() || null,
      errorCode: null,
      errorMessage: null,
    },
  });
}

export async function markGenerationSucceeded(
  shop: string,
  generationId: string,
  input: {
    outputPayload?: Prisma.InputJsonValue;
    usage?: Prisma.InputJsonValue;
    costMicros?: bigint;
  } = {},
) {
  const generation = await requireGenerationForShop(shop, generationId);

  return prisma.generation.update({
    where: {
      id: generation.id,
    },
    data: {
      status: GenerationStatus.SUCCEEDED,
      completedAt: new Date(),
      errorCode: null,
      errorMessage: null,
      partialAssetId: null,
      partialIndex: null,
      ...(input.outputPayload === undefined
        ? {}
        : { outputPayload: input.outputPayload }),
      ...(input.usage === undefined ? {} : { usage: input.usage }),
      ...(input.costMicros === undefined
        ? {}
        : { costMicros: input.costMicros }),
    },
  });
}

// Called once per streamed preview frame (see editOpenAIImage's
// onPartialImage) — overwrites the previous one, since only the
// latest preview is ever shown. Cleared back to null by
// markGenerationSucceeded/markGenerationFailed once there's a real
// result (or none coming).
export async function markGenerationPartial(
  shop: string,
  generationId: string,
  input: { partialAssetId: string; partialIndex: number },
) {
  const generation = await requireGenerationForShop(shop, generationId);

  return prisma.generation.update({
    where: {
      id: generation.id,
    },
    data: {
      partialAssetId: input.partialAssetId,
      partialIndex: input.partialIndex,
    },
  });
}

export async function markGenerationFailed(
  shop: string,
  generationId: string,
  input: {
    errorCode?: string | null;
    errorMessage: string;
    usage?: Prisma.InputJsonValue;
    costMicros?: bigint;
  },
) {
  const generation = await requireGenerationForShop(shop, generationId);

  return prisma.generation.update({
    where: {
      id: generation.id,
    },
    data: {
      status: GenerationStatus.FAILED,
      completedAt: new Date(),
      errorCode: input.errorCode?.trim() || null,
      errorMessage: input.errorMessage,
      partialAssetId: null,
      partialIndex: null,
      ...(input.usage === undefined ? {} : { usage: input.usage }),
      ...(input.costMicros === undefined
        ? {}
        : { costMicros: input.costMicros }),
    },
  });
}
