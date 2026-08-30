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

// Every mutation here (add/edit/delete/reorder) must be reflected in
// the Publish tab's "changes to push" detection — see the identical
// comment in style-size-options.server.ts.
async function touchStyle(styleId: string) {
  await prisma.style.update({
    where: { id: styleId },
    data: { updatedAt: new Date() },
  });
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

  const created = await prisma.styleFramingOption.create({
    data: {
      styleId,
      label: normalized.label,
      priceDelta: normalized.priceDelta,
      compareAtPriceDelta: normalized.compareAtPriceDelta,
      requiresShipping: normalized.requiresShipping,
      position: (lastOption?.position ?? -1) + 1,
    },
  });

  await touchStyle(styleId);

  return created;
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

  const updated = await prisma.styleFramingOption.update({
    where: { id: framingOptionId, styleId },
    data: {
      label: normalized.label,
      priceDelta: normalized.priceDelta,
      compareAtPriceDelta: normalized.compareAtPriceDelta,
      requiresShipping: normalized.requiresShipping,
    },
  });

  await touchStyle(styleId);

  return updated;
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

  await touchStyle(styleId);
}

/**
 * Sets an arbitrary new display order — the drag-and-drop reorder
 * counterpart to create/update/delete, mirroring reorderStyleFields.
 */
export async function reorderStyleFramingOptions(
  shop: string,
  styleId: string,
  orderedFramingOptionIds: string[],
) {
  await requireEditableStyle(shop, styleId);

  const options = await prisma.styleFramingOption.findMany({
    where: { styleId },
    select: { id: true },
  });

  const knownIds = new Set(options.map((option) => option.id));

  if (
    orderedFramingOptionIds.length !== options.length ||
    !orderedFramingOptionIds.every((id) => knownIds.has(id))
  ) {
    throw new Error(
      "The new framing order does not match this style's framing options.",
    );
  }

  await prisma.$transaction([
    ...orderedFramingOptionIds.map((id, index) =>
      prisma.styleFramingOption.update({
        where: { id },
        data: { position: index },
      }),
    ),
    prisma.style.update({
      where: { id: styleId },
      data: { updatedAt: new Date() },
    }),
  ]);
}
