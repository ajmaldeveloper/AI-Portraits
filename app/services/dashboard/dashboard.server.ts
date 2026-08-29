import { GenerationStatus, StyleStatus } from "@prisma/client";

import prisma from "../../db.server";

function normalizeShop(shop: string) {
  const value = shop.trim();

  if (!value) {
    throw new Error("Shop is required.");
  }

  return value;
}

export async function getDashboardForShop(shop: string) {
  const normalizedShop = normalizeShop(shop);

  const [
    totalStyles,
    draftStyles,
    publishedStyles,
    publishErrorStyles,
    unpublishedStyles,
    totalGenerations,
    successfulGenerations,
    failedGenerations,
    processingGenerations,
    queuedGenerations,
    draftsMissingPrompt,
    recentStyles,
  ] = await prisma.$transaction([
    prisma.style.count({
      where: {
        shop: normalizedShop,
      },
    }),

    prisma.style.count({
      where: {
        shop: normalizedShop,
        status: StyleStatus.DRAFT,
      },
    }),

    prisma.style.count({
      where: {
        shop: normalizedShop,
        status: StyleStatus.PUBLISHED,
      },
    }),

    prisma.style.count({
      where: {
        shop: normalizedShop,
        status: StyleStatus.PUBLISH_ERROR,
      },
    }),

    prisma.style.count({
      where: {
        shop: normalizedShop,
        status: StyleStatus.UNPUBLISHED,
      },
    }),

    prisma.generation.count({
      where: {
        shop: normalizedShop,
      },
    }),

    prisma.generation.count({
      where: {
        shop: normalizedShop,
        status: GenerationStatus.SUCCEEDED,
      },
    }),

    prisma.generation.count({
      where: {
        shop: normalizedShop,
        status: GenerationStatus.FAILED,
      },
    }),

    prisma.generation.count({
      where: {
        shop: normalizedShop,
        status: GenerationStatus.PROCESSING,
      },
    }),

    prisma.generation.count({
      where: {
        shop: normalizedShop,
        status: GenerationStatus.QUEUED,
      },
    }),

    prisma.style.count({
      where: {
        shop: normalizedShop,
        status: StyleStatus.DRAFT,
        prompt: "",
      },
    }),

    prisma.style.findMany({
      where: {
        shop: normalizedShop,
      },

      take: 5,

      orderBy: {
        updatedAt: "desc",
      },

      select: {
        id: true,
        name: true,
        prompt: true,
        productTitle: true,
        status: true,
        shopifyProductId: true,
        updatedAt: true,

        _count: {
          select: {
            fields: true,
            assets: true,
            generations: true,
          },
        },

        // Minimal readiness inputs — lets callers compute publish
        // readiness (via getStyleReadiness) without a second query.
        fields: {
          select: {
            type: true,
          },
        },

        assets: {
          select: {
            kind: true,
          },
        },
      },
    }),
  ]);

  const completedGenerations = successfulGenerations + failedGenerations;

  const successRate =
    completedGenerations === 0
      ? null
      : Math.round((successfulGenerations / completedGenerations) * 100);

  return {
    totalStyles,
    draftStyles,
    publishedStyles,
    publishErrorStyles,
    unpublishedStyles,

    totalGenerations,
    successfulGenerations,
    failedGenerations,
    processingGenerations,
    queuedGenerations,
    successRate,

    draftsMissingPrompt,

    recentStyles,
  };
}
