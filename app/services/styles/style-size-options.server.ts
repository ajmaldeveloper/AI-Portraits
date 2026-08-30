import prisma from "../../db.server";
import { requireStyleForShop, styleCanBeEdited } from "./style.server";

// Per-style print/download size variants, edited one at a time via
// modals on the Product tab — see StyleSizeOption in schema.prisma. An
// empty list means the product stays single-variant at publish time
// (style-publish.server.ts); a merchant opts in by adding rows here.

export type StyleSizeOptionInput = {
  label: string;
  scalePercent: number;
  price: string;
  compareAtPrice: string | null;
};

function requiredText(value: string, fieldName: string) {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
}

const decimalPattern = /^\d+(?:\.\d{1,2})?$/;

function validateInput(input: StyleSizeOptionInput) {
  const label = requiredText(input.label, "Size name");

  if (
    !Number.isInteger(input.scalePercent) ||
    input.scalePercent < 1 ||
    input.scalePercent > 100
  ) {
    throw new Error("Scale must be between 1 and 100%.");
  }

  if (!decimalPattern.test(input.price)) {
    throw new Error(
      "Price must be a non-negative number with up to two decimal places.",
    );
  }

  if (input.compareAtPrice && !decimalPattern.test(input.compareAtPrice)) {
    throw new Error(
      "Compare-at price must be a non-negative number with up to two decimal places.",
    );
  }

  return { ...input, label };
}

async function requireEditableStyle(shop: string, styleId: string) {
  const style = await requireStyleForShop(shop, styleId);

  if (!styleCanBeEdited(style)) {
    throw new Error(
      `Sizes cannot be changed while the style status is ${style.status}.`,
    );
  }

  return style;
}

async function assertUniqueLabel(
  styleId: string,
  label: string,
  excludeId?: string,
) {
  const existing = await prisma.styleSizeOption.findUnique({
    where: { styleId_label: { styleId, label } },
    select: { id: true },
  });

  if (existing && existing.id !== excludeId) {
    throw new Error("A size with this name already exists.");
  }
}

/**
 * At least one size must stay at 100% (the original resolution)
 * whenever any sizes exist at all — otherwise every size on the
 * product would be an upscale-free downscale with nothing to downscale
 * FROM at full quality.
 */
async function assertKeepsA100PercentOption(
  styleId: string,
  excludeId?: string,
) {
  const remaining = await prisma.styleSizeOption.findMany({
    where: { styleId, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { scalePercent: true },
  });

  if (remaining.length > 0 && !remaining.some((row) => row.scalePercent === 100)) {
    throw new Error(
      "Keep at least one size at 100% (the original resolution).",
    );
  }
}

export async function createStyleSizeOption(
  shop: string,
  styleId: string,
  input: StyleSizeOptionInput,
) {
  await requireEditableStyle(shop, styleId);

  const normalized = validateInput(input);

  await assertUniqueLabel(styleId, normalized.label);

  const lastOption = await prisma.styleSizeOption.findFirst({
    where: { styleId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  return prisma.styleSizeOption.create({
    data: {
      styleId,
      label: normalized.label,
      scalePercent: normalized.scalePercent,
      price: normalized.price,
      compareAtPrice: normalized.compareAtPrice,
      position: (lastOption?.position ?? -1) + 1,
    },
  });
}

export async function updateStyleSizeOption(
  shop: string,
  styleId: string,
  sizeOptionId: string,
  input: StyleSizeOptionInput,
) {
  await requireEditableStyle(shop, styleId);

  const normalized = validateInput(input);

  await assertUniqueLabel(styleId, normalized.label, sizeOptionId);

  if (normalized.scalePercent !== 100) {
    await assertKeepsA100PercentOption(styleId, sizeOptionId);
  }

  return prisma.styleSizeOption.update({
    where: { id: sizeOptionId, styleId },
    data: {
      label: normalized.label,
      scalePercent: normalized.scalePercent,
      price: normalized.price,
      compareAtPrice: normalized.compareAtPrice,
    },
  });
}

export async function deleteStyleSizeOption(
  shop: string,
  styleId: string,
  sizeOptionId: string,
) {
  await requireEditableStyle(shop, styleId);

  const target = await prisma.styleSizeOption.findFirst({
    where: { id: sizeOptionId, styleId },
    select: { id: true, scalePercent: true },
  });

  if (!target) {
    throw new Error("Size was not found.");
  }

  if (target.scalePercent === 100) {
    await assertKeepsA100PercentOption(styleId, sizeOptionId);
  }

  await prisma.styleSizeOption.delete({
    where: { id: sizeOptionId },
  });
}
