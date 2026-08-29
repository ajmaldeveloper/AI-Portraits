import { Prisma, StyleStatus, type Style } from "@prisma/client";

import prisma from "../../db.server";
import { getGenerationDefaults } from "../settings/generation-defaults.server";

export type CreateStyleDraftInput = {
  name: string;
  prompt?: string;
  provider?: string;
  model?: string | null;
  outputAspectRatio?: string;
  outputQuality?: string;
  previewCount?: number;

  productTitle?: string;
  productDescription?: string;
  basePrice?: string;
  compareAtPrice?: string | null;
  tags?: string[];
  collectionIds?: string[];

  generationSettings?: Prisma.InputJsonValue;
  productSettings?: Prisma.InputJsonValue;
};

export type UpdateStyleDraftInput = Partial<CreateStyleDraftInput>;

// A Style stays fully editable once it's live (PUBLISHED) — a merchant
// should be able to change the prompt, product details, generation
// settings, customer fields, or media on an already-published product
// without unpublishing first. Only the transient PUBLISHING/
// UNPUBLISHING states (a publish job actively in flight) are excluded.
const editableStatuses = new Set<StyleStatus>([
  StyleStatus.DRAFT,
  StyleStatus.PUBLISH_ERROR,
  StyleStatus.UNPUBLISHED,
  StyleStatus.PUBLISHED,
]);

const mediaEditableStatuses = editableStatuses;

// Deleting a PUBLISHED style also deletes its linked Shopify product
// (see deleteStyleAndShopifyProduct / bulkDeleteStylesAndShopifyProducts
// in style-publish.server.ts) — only an actively in-flight publish or
// unpublish job blocks deletion.
const deletableStatuses = new Set<StyleStatus>([
  StyleStatus.DRAFT,
  StyleStatus.PUBLISH_ERROR,
  StyleStatus.UNPUBLISHED,
  StyleStatus.PUBLISHED,
]);

function normalizeRequiredText(value: string, fieldName: string) {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
}

function normalizeOptionalText(value: string | null | undefined) {
  if (value == null) {
    return null;
  }

  const normalized = value.trim();

  return normalized || null;
}

function validatePreviewCount(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 4) {
    throw new Error("Preview count must be an integer between 1 and 4.");
  }

  return value;
}

export type StyleListSort = "updated_desc" | "updated_asc" | "name_asc";

export type StyleListFilters = {
  search?: string;
  status?: StyleStatus;
  sort?: StyleListSort;
  page?: number;
  pageSize?: number;
};

const sortOrderBy: Record<StyleListSort, Prisma.StyleOrderByWithRelationInput> =
  {
    updated_desc: {
      updatedAt: "desc",
    },
    updated_asc: {
      updatedAt: "asc",
    },
    name_asc: {
      name: "asc",
    },
  };

export async function listStylesForShop(
  shop: string,
  filters: StyleListFilters = {},
) {
  const normalizedShop = normalizeRequiredText(shop, "Shop");

  const page = Math.max(1, filters.page ?? 1);

  const pageSize = filters.pageSize ?? 20;

  const search = filters.search?.trim();

  const where: Prisma.StyleWhereInput = {
    shop: normalizedShop,

    ...(filters.status ? { status: filters.status } : {}),

    ...(search
      ? {
          OR: [
            { name: { contains: search } },
            { productTitle: { contains: search } },
          ],
        }
      : {}),
  };

  const [total, styles] = await prisma.$transaction([
    prisma.style.count({
      where,
    }),

    prisma.style.findMany({
      where,

      orderBy: sortOrderBy[filters.sort ?? "updated_desc"],

      skip: (page - 1) * pageSize,

      take: pageSize,

      include: {
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

  return {
    total,
    page,
    pageSize,
    hasPreviousPage: page > 1,
    hasNextPage: page * pageSize < total,
    styles,
  };
}

export async function getStyleForShop(shop: string, styleId: string) {
  const normalizedShop = normalizeRequiredText(shop, "Shop");

  const normalizedStyleId = normalizeRequiredText(styleId, "Style ID");

  return prisma.style.findFirst({
    where: {
      id: normalizedStyleId,
      shop: normalizedShop,
    },

    include: {
      fields: {
        orderBy: {
          position: "asc",
        },
      },

      assets: {
        orderBy: {
          position: "asc",
        },

        select: {
          id: true,
          styleId: true,
          generationId: true,
          kind: true,
          storageKey: true,
          url: true,
          mimeType: true,
          width: true,
          height: true,
          altText: true,
          position: true,
          shopifyMediaId: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });
}

export async function requireStyleForShop(shop: string, styleId: string) {
  const style = await getStyleForShop(shop, styleId);

  if (!style) {
    throw new Response("Style not found", {
      status: 404,
    });
  }

  return style;
}

export async function createStyleDraft(
  shop: string,
  input: CreateStyleDraftInput,
) {
  const normalizedShop = normalizeRequiredText(shop, "Shop");

  const name = normalizeRequiredText(input.name, "Style name");

  // Generation output (aspect ratio, quality, preview count) is a
  // shop-wide default set once in Settings, not per-style — new styles
  // snapshot whatever the shop default is at creation time.
  const defaults = await getGenerationDefaults(normalizedShop);

  const previewCount =
    input.previewCount === undefined
      ? defaults.previewCount
      : validatePreviewCount(input.previewCount);

  const productTitle = input.productTitle?.trim() || name;

  return prisma.style.create({
    data: {
      shop: normalizedShop,
      name,
      status: StyleStatus.DRAFT,

      prompt: input.prompt?.trim() ?? "",

      provider: input.provider?.trim() || "openai",

      model: normalizeOptionalText(input.model),

      outputAspectRatio:
        input.outputAspectRatio?.trim() || defaults.outputAspectRatio,

      outputQuality: input.outputQuality?.trim() || defaults.outputQuality,

      previewCount,

      generationSettings: input.generationSettings ?? {},

      productTitle,

      productDescription: input.productDescription?.trim() ?? "",

      basePrice: input.basePrice ?? "0.00",

      compareAtPrice: normalizeOptionalText(input.compareAtPrice),

      tags: input.tags ?? [],

      collectionIds: input.collectionIds ?? [],

      productSettings: input.productSettings ?? {},
    },
  });
}

export async function updateStyleDraft(
  shop: string,
  styleId: string,
  input: UpdateStyleDraftInput,
) {
  const style = await requireStyleForShop(shop, styleId);

  if (!editableStatuses.has(style.status)) {
    throw new Error(
      `Style cannot be edited while its status is ${style.status}.`,
    );
  }

  const data: Prisma.StyleUpdateInput = {};

  if (input.name !== undefined) {
    data.name = normalizeRequiredText(input.name, "Style name");
  }

  if (input.prompt !== undefined) {
    data.prompt = input.prompt.trim();
  }

  if (input.provider !== undefined) {
    data.provider = normalizeRequiredText(input.provider, "AI provider");
  }

  if (input.model !== undefined) {
    data.model = normalizeOptionalText(input.model);
  }

  if (input.outputAspectRatio !== undefined) {
    data.outputAspectRatio = normalizeRequiredText(
      input.outputAspectRatio,
      "Output aspect ratio",
    );
  }

  if (input.outputQuality !== undefined) {
    data.outputQuality = normalizeRequiredText(
      input.outputQuality,
      "Output quality",
    );
  }

  if (input.previewCount !== undefined) {
    data.previewCount = validatePreviewCount(input.previewCount);
  }

  if (input.productTitle !== undefined) {
    data.productTitle = normalizeRequiredText(
      input.productTitle,
      "Product title",
    );
  }

  if (input.productDescription !== undefined) {
    data.productDescription = input.productDescription.trim();
  }

  if (input.basePrice !== undefined) {
    data.basePrice = input.basePrice;
  }

  if (input.compareAtPrice !== undefined) {
    data.compareAtPrice = normalizeOptionalText(input.compareAtPrice);
  }

  if (input.tags !== undefined) {
    data.tags = input.tags;
  }

  if (input.collectionIds !== undefined) {
    data.collectionIds = input.collectionIds;
  }

  if (input.generationSettings !== undefined) {
    data.generationSettings = input.generationSettings;
  }

  if (input.productSettings !== undefined) {
    data.productSettings = input.productSettings;
  }

  return prisma.style.update({
    where: {
      id: style.id,
    },
    data,
  });
}

export function styleCanBeEdited(style: Pick<Style, "status">) {
  return editableStatuses.has(style.status);
}

export function styleMediaCanBeEdited(style: Pick<Style, "status">) {
  return mediaEditableStatuses.has(style.status);
}

export function styleCanBeDeleted(style: Pick<Style, "status">) {
  return deletableStatuses.has(style.status);
}

/**
 * Creates a new DRAFT Style copied from an existing one.
 *
 * Copies AI transformation settings, product draft configuration, and
 * customer fields. Does NOT copy generated images, generation history,
 * or any Shopify linkage — the duplicate starts as a fresh, unpublished
 * app-only draft with its own future Shopify product.
 */
export async function duplicateStyleDraft(shop: string, styleId: string) {
  const source = await requireStyleForShop(shop, styleId);

  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.style.create({
      data: {
        shop: source.shop,
        name: `${source.name} copy`,
        status: StyleStatus.DRAFT,

        prompt: source.prompt,
        provider: source.provider,
        model: source.model,
        outputAspectRatio: source.outputAspectRatio,
        outputQuality: source.outputQuality,
        previewCount: source.previewCount,
        generationSettings: source.generationSettings ?? {},

        productTitle: `${source.productTitle} copy`,
        productDescription: source.productDescription,
        basePrice: source.basePrice,
        compareAtPrice: source.compareAtPrice,
        tags: source.tags ?? [],
        collectionIds: source.collectionIds ?? [],
        productSettings: {},
      },
    });

    if (source.fields.length > 0) {
      await tx.styleField.createMany({
        data: source.fields.map((field) => ({
          styleId: duplicate.id,
          key: field.key,
          label: field.label,
          type: field.type,
          required: field.required,
          position: field.position,
          placeholder: field.placeholder,
          helpText: field.helpText,
          defaultValue: field.defaultValue,
          options: field.options ?? undefined,
          config: field.config ?? undefined,
        })),
      });
    }

    return duplicate;
  });
}
