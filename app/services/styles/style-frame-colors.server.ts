import prisma from "../../db.server";
import { requireStyleForShop, styleCanBeEdited } from "./style.server";

// Reusable, per-style list of frame colors, edited one at a time via
// modals on the Product tab — see StyleFrameColor in schema.prisma. A
// Framing option picks one of these (or none) via frameColorId rather
// than a hex value typed inline. Purely app-owned visual data, never
// sent to Shopify.

export type StyleFrameColorInput = {
  label: string;
  hexColor: string;
};

const hexColorPattern = /^#[0-9a-fA-F]{6}$/;

function validateInput(input: StyleFrameColorInput) {
  const label = input.label.trim();

  if (!label) {
    throw new Error("Color name is required.");
  }

  const hexColor = input.hexColor.trim();

  if (!hexColorPattern.test(hexColor)) {
    throw new Error("Enter a valid hex color (e.g. #1a1a1a).");
  }

  return { label, hexColor };
}

async function requireEditableStyle(shop: string, styleId: string) {
  const style = await requireStyleForShop(shop, styleId);

  if (!styleCanBeEdited(style)) {
    throw new Error(
      `Frame colors cannot be changed while the style status is ${style.status}.`,
    );
  }

  return style;
}

async function assertUniqueLabel(
  styleId: string,
  label: string,
  excludeId?: string,
) {
  const existing = await prisma.styleFrameColor.findUnique({
    where: { styleId_label: { styleId, label } },
    select: { id: true },
  });

  if (existing && existing.id !== excludeId) {
    throw new Error("A frame color with this name already exists.");
  }
}

export async function createStyleFrameColor(
  shop: string,
  styleId: string,
  input: StyleFrameColorInput,
) {
  await requireEditableStyle(shop, styleId);

  const normalized = validateInput(input);

  await assertUniqueLabel(styleId, normalized.label);

  const lastOption = await prisma.styleFrameColor.findFirst({
    where: { styleId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  return prisma.styleFrameColor.create({
    data: {
      styleId,
      label: normalized.label,
      hexColor: normalized.hexColor,
      position: (lastOption?.position ?? -1) + 1,
    },
  });
}

export async function updateStyleFrameColor(
  shop: string,
  styleId: string,
  frameColorId: string,
  input: StyleFrameColorInput,
) {
  await requireEditableStyle(shop, styleId);

  const normalized = validateInput(input);

  await assertUniqueLabel(styleId, normalized.label, frameColorId);

  return prisma.styleFrameColor.update({
    where: { id: frameColorId, styleId },
    data: {
      label: normalized.label,
      hexColor: normalized.hexColor,
    },
  });
}

export async function deleteStyleFrameColor(
  shop: string,
  styleId: string,
  frameColorId: string,
) {
  await requireEditableStyle(shop, styleId);

  const target = await prisma.styleFrameColor.findFirst({
    where: { id: frameColorId, styleId },
    select: { id: true },
  });

  if (!target) {
    throw new Error("Frame color was not found.");
  }

  // Any Framing option referencing this color falls back to no visual
  // frame (frameColorId SetNull) rather than being blocked or cascaded.
  await prisma.styleFrameColor.delete({
    where: { id: frameColorId },
  });
}

/**
 * Sets an arbitrary new display order — the drag-and-drop reorder
 * counterpart to create/update/delete, mirroring reorderStyleFields.
 */
export async function reorderStyleFrameColors(
  shop: string,
  styleId: string,
  orderedFrameColorIds: string[],
) {
  await requireEditableStyle(shop, styleId);

  const options = await prisma.styleFrameColor.findMany({
    where: { styleId },
    select: { id: true },
  });

  const knownIds = new Set(options.map((option) => option.id));

  if (
    orderedFrameColorIds.length !== options.length ||
    !orderedFrameColorIds.every((id) => knownIds.has(id))
  ) {
    throw new Error(
      "The new color order does not match this style's frame colors.",
    );
  }

  await prisma.$transaction(
    orderedFrameColorIds.map((id, index) =>
      prisma.styleFrameColor.update({
        where: { id },
        data: { position: index },
      }),
    ),
  );
}
