import prisma from "../../db.server";
import { requireStyleForShop, styleCanBeEdited } from "./style.server";

// Reusable, per-style list of mat colors, edited one at a time via
// modals on the Product tab — see StyleMatColor in schema.prisma.
// Purely app-owned visual data, never sent to Shopify, and
// price-neutral — selected independently by the customer on the
// storefront, layered as an inner ring between the frame border and
// the photo.

export type StyleMatColorInput = {
  label: string;
  hexColor: string;
};

const hexColorPattern = /^#[0-9a-fA-F]{6}$/;

function validateInput(input: StyleMatColorInput) {
  const label = input.label.trim();

  if (!label) {
    throw new Error("Mat color name is required.");
  }

  const hexColor = input.hexColor.trim();

  if (!hexColorPattern.test(hexColor)) {
    throw new Error("Enter a valid hex color (e.g. #ffffff).");
  }

  return { label, hexColor };
}

async function requireEditableStyle(shop: string, styleId: string) {
  const style = await requireStyleForShop(shop, styleId);

  if (!styleCanBeEdited(style)) {
    throw new Error(
      `Mat colors cannot be changed while the style status is ${style.status}.`,
    );
  }

  return style;
}

async function assertUniqueLabel(
  styleId: string,
  label: string,
  excludeId?: string,
) {
  const existing = await prisma.styleMatColor.findUnique({
    where: { styleId_label: { styleId, label } },
    select: { id: true },
  });

  if (existing && existing.id !== excludeId) {
    throw new Error("A mat color with this name already exists.");
  }
}

export async function createStyleMatColor(
  shop: string,
  styleId: string,
  input: StyleMatColorInput,
) {
  await requireEditableStyle(shop, styleId);

  const normalized = validateInput(input);

  await assertUniqueLabel(styleId, normalized.label);

  const lastOption = await prisma.styleMatColor.findFirst({
    where: { styleId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  return prisma.styleMatColor.create({
    data: {
      styleId,
      label: normalized.label,
      hexColor: normalized.hexColor,
      position: (lastOption?.position ?? -1) + 1,
    },
  });
}

export async function updateStyleMatColor(
  shop: string,
  styleId: string,
  matColorId: string,
  input: StyleMatColorInput,
) {
  await requireEditableStyle(shop, styleId);

  const normalized = validateInput(input);

  await assertUniqueLabel(styleId, normalized.label, matColorId);

  return prisma.styleMatColor.update({
    where: { id: matColorId, styleId },
    data: {
      label: normalized.label,
      hexColor: normalized.hexColor,
    },
  });
}

export async function deleteStyleMatColor(
  shop: string,
  styleId: string,
  matColorId: string,
) {
  await requireEditableStyle(shop, styleId);

  const target = await prisma.styleMatColor.findFirst({
    where: { id: matColorId, styleId },
    select: { id: true },
  });

  if (!target) {
    throw new Error("Mat color was not found.");
  }

  await prisma.styleMatColor.delete({
    where: { id: matColorId },
  });
}

/**
 * Sets an arbitrary new display order — the drag-and-drop reorder
 * counterpart to create/update/delete, mirroring reorderStyleFields.
 */
export async function reorderStyleMatColors(
  shop: string,
  styleId: string,
  orderedMatColorIds: string[],
) {
  await requireEditableStyle(shop, styleId);

  const options = await prisma.styleMatColor.findMany({
    where: { styleId },
    select: { id: true },
  });

  const knownIds = new Set(options.map((option) => option.id));

  if (
    orderedMatColorIds.length !== options.length ||
    !orderedMatColorIds.every((id) => knownIds.has(id))
  ) {
    throw new Error(
      "The new mat color order does not match this style's mat colors.",
    );
  }

  await prisma.$transaction(
    orderedMatColorIds.map((id, index) =>
      prisma.styleMatColor.update({
        where: { id },
        data: { position: index },
      }),
    ),
  );
}
