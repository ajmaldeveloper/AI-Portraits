import prisma from "../../db.server";
import { requireStyleForShop, styleCanBeEdited } from "./style.server";

// Reusable, per-style list of frame border treatments, edited one at
// a time via modals on the Product tab — see StyleFrameStyle in
// schema.prisma. label is a freely-renameable merchant-facing display
// name; cssTreatment is which of this app's fixed CSS implementations
// it maps to. A Framing option picks one of these (or none) via
// frameStyleId. Purely app-owned visual data, never sent to Shopify.

export const CSS_TREATMENTS = ["thin", "gallery", "classic"] as const;

export type CssTreatment = (typeof CSS_TREATMENTS)[number];

export type StyleFrameStyleInput = {
  label: string;
  cssTreatment: string;
};

function validateInput(input: StyleFrameStyleInput) {
  const label = input.label.trim();

  if (!label) {
    throw new Error("Style name is required.");
  }

  const cssTreatment = input.cssTreatment.trim();

  if (!CSS_TREATMENTS.includes(cssTreatment as CssTreatment)) {
    throw new Error("Choose a supported border treatment.");
  }

  return { label, cssTreatment };
}

async function requireEditableStyle(shop: string, styleId: string) {
  const style = await requireStyleForShop(shop, styleId);

  if (!styleCanBeEdited(style)) {
    throw new Error(
      `Frame styles cannot be changed while the style status is ${style.status}.`,
    );
  }

  return style;
}

async function assertUniqueLabel(
  styleId: string,
  label: string,
  excludeId?: string,
) {
  const existing = await prisma.styleFrameStyle.findUnique({
    where: { styleId_label: { styleId, label } },
    select: { id: true },
  });

  if (existing && existing.id !== excludeId) {
    throw new Error("A frame style with this name already exists.");
  }
}

export async function createStyleFrameStyle(
  shop: string,
  styleId: string,
  input: StyleFrameStyleInput,
) {
  await requireEditableStyle(shop, styleId);

  const normalized = validateInput(input);

  await assertUniqueLabel(styleId, normalized.label);

  const lastOption = await prisma.styleFrameStyle.findFirst({
    where: { styleId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  return prisma.styleFrameStyle.create({
    data: {
      styleId,
      label: normalized.label,
      cssTreatment: normalized.cssTreatment,
      position: (lastOption?.position ?? -1) + 1,
    },
  });
}

export async function updateStyleFrameStyle(
  shop: string,
  styleId: string,
  frameStyleId: string,
  input: StyleFrameStyleInput,
) {
  await requireEditableStyle(shop, styleId);

  const normalized = validateInput(input);

  await assertUniqueLabel(styleId, normalized.label, frameStyleId);

  return prisma.styleFrameStyle.update({
    where: { id: frameStyleId, styleId },
    data: {
      label: normalized.label,
      cssTreatment: normalized.cssTreatment,
    },
  });
}

export async function deleteStyleFrameStyle(
  shop: string,
  styleId: string,
  frameStyleId: string,
) {
  await requireEditableStyle(shop, styleId);

  const target = await prisma.styleFrameStyle.findFirst({
    where: { id: frameStyleId, styleId },
    select: { id: true },
  });

  if (!target) {
    throw new Error("Frame style was not found.");
  }

  // Any Framing option referencing this style falls back to no visual
  // frame (frameStyleId SetNull) rather than being blocked or cascaded.
  await prisma.styleFrameStyle.delete({
    where: { id: frameStyleId },
  });
}

/**
 * Sets an arbitrary new display order — the drag-and-drop reorder
 * counterpart to create/update/delete, mirroring reorderStyleFields.
 */
export async function reorderStyleFrameStyles(
  shop: string,
  styleId: string,
  orderedFrameStyleIds: string[],
) {
  await requireEditableStyle(shop, styleId);

  const options = await prisma.styleFrameStyle.findMany({
    where: { styleId },
    select: { id: true },
  });

  const knownIds = new Set(options.map((option) => option.id));

  if (
    orderedFrameStyleIds.length !== options.length ||
    !orderedFrameStyleIds.every((id) => knownIds.has(id))
  ) {
    throw new Error(
      "The new style order does not match this style's frame styles.",
    );
  }

  await prisma.$transaction(
    orderedFrameStyleIds.map((id, index) =>
      prisma.styleFrameStyle.update({
        where: { id },
        data: { position: index },
      }),
    ),
  );
}
