import prisma from "../../db.server";
import { requireStyleForShop, styleCanBeEdited } from "./style.server";

// Generalized product options — see StyleOption/StyleOptionChoice's
// own comments in schema.prisma for the full model. Edited one option
// (and, nested under it, one choice) at a time via modals on the
// Product options tab, mirroring the exact CRUD shape the old
// StyleSizeOption/StyleFramingOption/StyleMatColor services used
// (requireEditableStyle, assertUniqueLabel, touchStyle) — just
// generalized to branch on type/role/axisRole instead of being one
// hardcoded shape per file.

export const STYLE_OPTION_TYPES = ["TEXT", "COLOR_SWATCH"] as const;
export type StyleOptionTypeValue = (typeof STYLE_OPTION_TYPES)[number];

export const STYLE_OPTION_AXIS_ROLES = ["SIZE", "FRAMING"] as const;
export type StyleOptionAxisRoleValue = (typeof STYLE_OPTION_AXIS_ROLES)[number];

export const STYLE_OPTION_IMAGE_ORIENTATIONS = ["HORIZONTAL", "VERTICAL"] as const;
export type StyleOptionImageOrientationValue =
  (typeof STYLE_OPTION_IMAGE_ORIENTATIONS)[number];

export const STYLE_OPTION_IMAGE_FITS = ["FILL", "ORIGINAL"] as const;
export type StyleOptionImageFitValue = (typeof STYLE_OPTION_IMAGE_FITS)[number];

export type StyleOptionInput = {
  label: string;
  type: string;
  axisRole: string | null;
  imageOrientation: string;
  imageFit: string;
};

export type StyleOptionChoiceInput = {
  label: string;
  priceDelta: string | null;
  compareAtPriceDelta: string | null;
  requiresShipping: boolean;
  scalePercent: number | null;
  hexColor: string | null;
  imageAssetId: string | null;
  borderThicknessPx: number | null;
  matThicknessPx: number | null;
  borderRadiusPx: number | null;
};

const decimalPattern = /^-?\d+(?:\.\d{1,2})?$/;
const hexColorPattern = /^#[0-9a-fA-F]{6}$/;

function requiredText(value: string, fieldName: string) {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
}

// null/blank stays null (falls back to the storefront's own default);
// anything else must be a real, positive whole pixel count.
function normalizeOptionalPositiveInt(value: number | null, fieldName: string) {
  if (value === null) {
    return null;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${fieldName} must be a positive whole number of pixels.`);
  }

  return value;
}

// Same, but 0 is valid (a corner radius of 0 is a real, meaningful
// choice — square corners — not "unset").
function normalizeOptionalNonNegativeInt(value: number | null, fieldName: string) {
  if (value === null) {
    return null;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative whole number of pixels.`);
  }

  return value;
}

async function requireEditableStyle(shop: string, styleId: string) {
  const style = await requireStyleForShop(shop, styleId);

  if (!styleCanBeEdited(style)) {
    throw new Error(
      `Product options cannot be changed while the style status is ${style.status}.`,
    );
  }

  return style;
}

function validateOptionInput(input: StyleOptionInput) {
  const label = requiredText(input.label, "Option name");

  if (!STYLE_OPTION_TYPES.includes(input.type as StyleOptionTypeValue)) {
    throw new Error("Choose a valid option type.");
  }

  const axisRole = input.axisRole?.trim() || null;

  if (
    axisRole &&
    !STYLE_OPTION_AXIS_ROLES.includes(axisRole as StyleOptionAxisRoleValue)
  ) {
    throw new Error("Choose a valid axis role.");
  }

  if (
    !STYLE_OPTION_IMAGE_ORIENTATIONS.includes(
      input.imageOrientation as StyleOptionImageOrientationValue,
    )
  ) {
    throw new Error("Choose a valid image orientation.");
  }

  if (!STYLE_OPTION_IMAGE_FITS.includes(input.imageFit as StyleOptionImageFitValue)) {
    throw new Error("Choose a valid image fit.");
  }

  return {
    label,
    type: input.type as StyleOptionTypeValue,
    axisRole: axisRole as StyleOptionAxisRoleValue | null,
    imageOrientation: input.imageOrientation as StyleOptionImageOrientationValue,
    imageFit: input.imageFit as StyleOptionImageFitValue,
  };
}

async function assertUniqueOptionLabel(
  styleId: string,
  label: string,
  excludeId?: string,
) {
  const existing = await prisma.styleOption.findUnique({
    where: { styleId_label: { styleId, label } },
    select: { id: true },
  });

  if (existing && existing.id !== excludeId) {
    throw new Error("An option with this name already exists.");
  }
}

// At most one option per style may hold each of SIZE/FRAMING — the
// two axis roles the publish engine and storefront give special
// meaning to (see StyleOption's schema.prisma comment). Not
// expressible as a DB constraint (Postgres partial-unique indexes
// aren't in Prisma's schema DSL), so enforced here.
async function assertUniqueAxisRole(
  styleId: string,
  axisRole: StyleOptionAxisRoleValue | null,
  excludeId?: string,
) {
  if (!axisRole) {
    return;
  }

  const existing = await prisma.styleOption.findFirst({
    where: {
      styleId,
      axisRole,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, label: true },
  });

  if (existing) {
    throw new Error(
      `"${existing.label}" already drives ${axisRole === "SIZE" ? "Size" : "Framing"} — only one option can.`,
    );
  }
}

export async function createStyleOption(
  shop: string,
  styleId: string,
  input: StyleOptionInput,
) {
  await requireEditableStyle(shop, styleId);

  const normalized = validateOptionInput(input);

  await assertUniqueOptionLabel(styleId, normalized.label);

  await assertUniqueAxisRole(styleId, normalized.axisRole);

  const lastOption = await prisma.styleOption.findFirst({
    where: { styleId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  return prisma.styleOption.create({
    data: {
      styleId,
      label: normalized.label,
      type: normalized.type,
      axisRole: normalized.axisRole,
      imageOrientation: normalized.imageOrientation,
      imageFit: normalized.imageFit,
      position: (lastOption?.position ?? -1) + 1,
    },
  });
}

export async function updateStyleOption(
  shop: string,
  styleId: string,
  optionId: string,
  input: StyleOptionInput,
) {
  await requireEditableStyle(shop, styleId);

  const normalized = validateOptionInput(input);

  await assertUniqueOptionLabel(styleId, normalized.label, optionId);

  await assertUniqueAxisRole(styleId, normalized.axisRole, optionId);

  return prisma.styleOption.update({
    where: { id: optionId, styleId },
    data: {
      label: normalized.label,
      type: normalized.type,
      axisRole: normalized.axisRole,
      imageOrientation: normalized.imageOrientation,
      imageFit: normalized.imageFit,
    },
  });
}

export async function deleteStyleOption(
  shop: string,
  styleId: string,
  optionId: string,
) {
  await requireEditableStyle(shop, styleId);

  const target = await prisma.styleOption.findFirst({
    where: { id: optionId, styleId },
    select: { id: true },
  });

  if (!target) {
    throw new Error("Option was not found.");
  }

  // Choices cascade-delete with it (StyleOptionChoice.optionId is
  // onDelete: Cascade).
  await prisma.styleOption.delete({
    where: { id: optionId },
  });
}

export async function reorderStyleOptions(
  shop: string,
  styleId: string,
  orderedOptionIds: string[],
) {
  await requireEditableStyle(shop, styleId);

  const options = await prisma.styleOption.findMany({
    where: { styleId },
    select: { id: true },
  });

  const knownIds = new Set(options.map((option) => option.id));

  if (
    orderedOptionIds.length !== options.length ||
    !orderedOptionIds.every((id) => knownIds.has(id))
  ) {
    throw new Error("The new option order does not match this style's options.");
  }

  await prisma.$transaction(
    orderedOptionIds.map((id, index) =>
      prisma.styleOption.update({
        where: { id },
        data: { position: index },
      }),
    ),
  );
}

async function requireOption(styleId: string, optionId: string) {
  const option = await prisma.styleOption.findFirst({
    where: { id: optionId, styleId },
  });

  if (!option) {
    throw new Error("Option was not found.");
  }

  return option;
}

async function validateChoiceInput(
  option: { id: string; styleId: string; type: string; axisRole: string | null },
  input: StyleOptionChoiceInput,
) {
  const label = requiredText(input.label, "Choice name");

  // Every option's choices may optionally carry a price, always as a
  // delta added on top of the Style's flat base price — null means
  // this choice never affects price (e.g. most Mat color choices, or
  // a Size choice with no upcharge).
  let priceDelta: string | null = null;
  let compareAtPriceDelta: string | null = null;

  const priceRaw = input.priceDelta?.trim() ?? "";

  if (priceRaw) {
    if (!decimalPattern.test(priceRaw)) {
      throw new Error(
        "Price adjustment must be a valid number with up to two decimal places.",
      );
    }

    priceDelta = priceRaw;
  }

  const compareAt = input.compareAtPriceDelta?.trim() || null;

  if (compareAt && !decimalPattern.test(compareAt)) {
    throw new Error(
      "Compare-at adjustment must be a valid number with up to two decimal places.",
    );
  }

  compareAtPriceDelta = compareAt;

  // Shipping only means anything for the one Framing-axis option.
  const requiresShipping =
    option.axisRole === "FRAMING" ? input.requiresShipping : false;

  // Scale only means anything for the one Size-axis option.
  let scalePercent: number | null = null;

  if (option.axisRole === "SIZE") {
    const value = input.scalePercent;

    if (!Number.isInteger(value) || value === null || value < 1 || value > 400) {
      throw new Error("Scale must be between 1 and 400%.");
    }

    scalePercent = value;
  }

  // Color only means anything for a COLOR_SWATCH-type option, and even
  // then it's optional — a colorless choice (e.g. "No Frame" on a
  // Framing axis) is exactly the signal that means "no visual frame
  // for this choice," the same way it did on the old, single-purpose
  // Framing model. Only the *format* is validated when something was
  // actually entered.
  let hexColor: string | null = null;

  if (option.type === "COLOR_SWATCH") {
    const value = input.hexColor?.trim() ?? "";

    if (value && !hexColorPattern.test(value)) {
      throw new Error("Enter a valid hex color (e.g. #1a1a1a).");
    }

    hexColor = value || null;
  }

  // Uploaded image is always optional, for any choice regardless of
  // type or axis — a plain reference photo everywhere except the one
  // axisRole FRAMING option, where it doubles as an uploaded frame
  // texture (rendered via CSS border-image). If provided, it must be
  // a real, already-uploaded asset belonging to this Style.
  let imageAssetId: string | null = null;

  const rawImageAssetId = input.imageAssetId?.trim() || null;

  if (rawImageAssetId) {
    const asset = await prisma.styleAsset.findFirst({
      where: { id: rawImageAssetId, styleId: option.styleId, kind: "FRAME_TEXTURE" },
      select: { id: true },
    });

    if (!asset) {
      throw new Error("That image was not found.");
    }

    imageAssetId = rawImageAssetId;
  }

  // Frame thickness, mat gap width, and corner radius only ever mean
  // anything on the one Framing axis, and are always optional — null
  // falls back to the storefront CSS's own default look, so a
  // merchant only sets these when they want to override it. Frame
  // thickness applies whether the border renders from hexColor,
  // imageAssetId, or both.
  let borderThicknessPx: number | null = null;
  let matThicknessPx: number | null = null;
  let borderRadiusPx: number | null = null;

  if (option.axisRole === "FRAMING") {
    borderThicknessPx = normalizeOptionalPositiveInt(
      input.borderThicknessPx,
      "Frame thickness",
    );

    matThicknessPx = normalizeOptionalPositiveInt(
      input.matThicknessPx,
      "Mat thickness",
    );

    borderRadiusPx = normalizeOptionalNonNegativeInt(
      input.borderRadiusPx,
      "Corner radius",
    );
  }

  return {
    label,
    priceDelta,
    compareAtPriceDelta,
    requiresShipping,
    scalePercent,
    hexColor,
    imageAssetId,
    borderThicknessPx,
    matThicknessPx,
    borderRadiusPx,
  };
}

async function assertUniqueChoiceLabel(
  optionId: string,
  label: string,
  excludeId?: string,
) {
  const existing = await prisma.styleOptionChoice.findUnique({
    where: { optionId_label: { optionId, label } },
    select: { id: true },
  });

  if (existing && existing.id !== excludeId) {
    throw new Error("A choice with this name already exists.");
  }
}

/**
 * At least one choice must stay at 100% scale whenever the parent is
 * the Size-axis option and has any choices at all — otherwise every
 * size on the product would be an upscale-free downscale with nothing
 * to downscale FROM at full quality. Generalizes the identical rule
 * the old StyleSizeOption service enforced.
 */
async function assertKeepsA100PercentChoice(optionId: string, excludeId?: string) {
  const remaining = await prisma.styleOptionChoice.findMany({
    where: { optionId, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { scalePercent: true },
  });

  if (
    remaining.length > 0 &&
    !remaining.some((choice) => choice.scalePercent === 100)
  ) {
    throw new Error("Keep at least one Size choice at 100% (the original resolution).");
  }
}

// Every mutation here (add/edit/delete/reorder, on either an option or
// a choice) must be reflected in the Publish tab's "changes to push"
// detection — see the identical comment on the old per-concept
// services this replaces.
async function touchStyle(styleId: string) {
  await prisma.style.update({
    where: { id: styleId },
    data: { updatedAt: new Date() },
  });
}

export async function createStyleOptionChoice(
  shop: string,
  styleId: string,
  optionId: string,
  input: StyleOptionChoiceInput,
) {
  await requireEditableStyle(shop, styleId);

  const option = await requireOption(styleId, optionId);

  const normalized = await validateChoiceInput(
    { ...option, styleId },
    input,
  );

  await assertUniqueChoiceLabel(optionId, normalized.label);

  const lastChoice = await prisma.styleOptionChoice.findFirst({
    where: { optionId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const created = await prisma.styleOptionChoice.create({
    data: {
      optionId,
      label: normalized.label,
      priceDelta: normalized.priceDelta,
      compareAtPriceDelta: normalized.compareAtPriceDelta,
      requiresShipping: normalized.requiresShipping,
      scalePercent: normalized.scalePercent,
      hexColor: normalized.hexColor,
      imageAssetId: normalized.imageAssetId,
      borderThicknessPx: normalized.borderThicknessPx,
      matThicknessPx: normalized.matThicknessPx,
      borderRadiusPx: normalized.borderRadiusPx,
      position: (lastChoice?.position ?? -1) + 1,
    },
  });

  await touchStyle(styleId);

  return created;
}

export async function updateStyleOptionChoice(
  shop: string,
  styleId: string,
  optionId: string,
  choiceId: string,
  input: StyleOptionChoiceInput,
) {
  await requireEditableStyle(shop, styleId);

  const option = await requireOption(styleId, optionId);

  const normalized = await validateChoiceInput(
    { ...option, styleId },
    input,
  );

  await assertUniqueChoiceLabel(optionId, normalized.label, choiceId);

  if (option.axisRole === "SIZE" && normalized.scalePercent !== 100) {
    await assertKeepsA100PercentChoice(optionId, choiceId);
  }

  const updated = await prisma.styleOptionChoice.update({
    where: { id: choiceId, optionId },
    data: {
      label: normalized.label,
      priceDelta: normalized.priceDelta,
      compareAtPriceDelta: normalized.compareAtPriceDelta,
      requiresShipping: normalized.requiresShipping,
      scalePercent: normalized.scalePercent,
      hexColor: normalized.hexColor,
      imageAssetId: normalized.imageAssetId,
      borderThicknessPx: normalized.borderThicknessPx,
      matThicknessPx: normalized.matThicknessPx,
      borderRadiusPx: normalized.borderRadiusPx,
    },
  });

  await touchStyle(styleId);

  return updated;
}

export async function deleteStyleOptionChoice(
  shop: string,
  styleId: string,
  optionId: string,
  choiceId: string,
) {
  await requireEditableStyle(shop, styleId);

  const option = await requireOption(styleId, optionId);

  const target = await prisma.styleOptionChoice.findFirst({
    where: { id: choiceId, optionId },
    select: { id: true, scalePercent: true },
  });

  if (!target) {
    throw new Error("Choice was not found.");
  }

  if (option.axisRole === "SIZE" && target.scalePercent === 100) {
    await assertKeepsA100PercentChoice(optionId, choiceId);
  }

  await prisma.styleOptionChoice.delete({
    where: { id: choiceId },
  });

  await touchStyle(styleId);
}

export async function reorderStyleOptionChoices(
  shop: string,
  styleId: string,
  optionId: string,
  orderedChoiceIds: string[],
) {
  await requireEditableStyle(shop, styleId);

  await requireOption(styleId, optionId);

  const choices = await prisma.styleOptionChoice.findMany({
    where: { optionId },
    select: { id: true },
  });

  const knownIds = new Set(choices.map((choice) => choice.id));

  if (
    orderedChoiceIds.length !== choices.length ||
    !orderedChoiceIds.every((id) => knownIds.has(id))
  ) {
    throw new Error("The new choice order does not match this option's choices.");
  }

  await prisma.$transaction([
    ...orderedChoiceIds.map((id, index) =>
      prisma.styleOptionChoice.update({
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
