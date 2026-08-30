import prisma from "../../db.server";
import { requireStyleForShop, styleCanBeEdited } from "./style.server";

// Per-style Framing variants, edited one at a time via modals on the
// Product tab — see StyleFramingOption in schema.prisma. Priced as a
// delta on top of whichever Size is chosen (or the Style's flat
// basePrice if no sizes exist), not an absolute price. An empty list
// is valid — no framing offered.

export type StyleFramingOptionInput = {
  label: string;
  priceDelta: string;
  compareAtPriceDelta: string | null;
  requiresShipping: boolean;
};

function requiredText(value: string, fieldName: string) {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
}

const decimalPattern = /^-?\d+(?:\.\d{1,2})?$/;

function validateInput(input: StyleFramingOptionInput) {
  const label = requiredText(input.label, "Framing name");

  if (!decimalPattern.test(input.priceDelta)) {
    throw new Error(
      "Price adjustment must be a valid number with up to two decimal places.",
    );
  }

  if (
    input.compareAtPriceDelta &&
    !decimalPattern.test(input.compareAtPriceDelta)
  ) {
    throw new Error(
      "Compare-at adjustment must be a valid number with up to two decimal places.",
    );
  }

  return { ...input, label };
}

async function requireEditableStyle(shop: string, styleId: string) {
  const style = await requireStyleForShop(shop, styleId);

  if (!styleCanBeEdited(style)) {
    throw new Error(
      `Framing options cannot be changed while the style status is ${style.status}.`,
    );
  }

  return style;
}

async function assertUniqueLabel(
  styleId: string,
  label: string,
  excludeId?: string,
) {
  const existing = await prisma.styleFramingOption.findUnique({
    where: { styleId_label: { styleId, label } },
    select: { id: true },
  });

  if (existing && existing.id !== excludeId) {
    throw new Error("A framing option with this name already exists.");
  }
}

export async function createStyleFramingOption(
  shop: string,
  styleId: string,
  input: StyleFramingOptionInput,
) {
  await requireEditableStyle(shop, styleId);

  const normalized = validateInput(input);

  await assertUniqueLabel(styleId, normalized.label);

  const lastOption = await prisma.styleFramingOption.findFirst({
    where: { styleId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  return prisma.styleFramingOption.create({
    data: {
      styleId,
      label: normalized.label,
      priceDelta: normalized.priceDelta,
      compareAtPriceDelta: normalized.compareAtPriceDelta,
      requiresShipping: normalized.requiresShipping,
      position: (lastOption?.position ?? -1) + 1,
    },
  });
}

export async function updateStyleFramingOption(
  shop: string,
  styleId: string,
  framingOptionId: string,
  input: StyleFramingOptionInput,
) {
  await requireEditableStyle(shop, styleId);

  const normalized = validateInput(input);

  await assertUniqueLabel(styleId, normalized.label, framingOptionId);

  return prisma.styleFramingOption.update({
    where: { id: framingOptionId, styleId },
    data: {
      label: normalized.label,
      priceDelta: normalized.priceDelta,
      compareAtPriceDelta: normalized.compareAtPriceDelta,
      requiresShipping: normalized.requiresShipping,
    },
  });
}

export async function deleteStyleFramingOption(
  shop: string,
  styleId: string,
  framingOptionId: string,
) {
  await requireEditableStyle(shop, styleId);

  const target = await prisma.styleFramingOption.findFirst({
    where: { id: framingOptionId, styleId },
    select: { id: true },
  });

  if (!target) {
    throw new Error("Framing option was not found.");
  }

  await prisma.styleFramingOption.delete({
    where: { id: framingOptionId },
  });
}
