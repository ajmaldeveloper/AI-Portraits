import prisma from "../../db.server";

// Shop-wide list of print/download sizes offered on every published
// product — see ShopSizeOption in schema.prisma for the field-level
// reasoning. Applied at publish time in style-publish.server.ts.

export type SizeOption = {
  id: string;
  label: string;
  scalePercent: number;
  priceDelta: string;
  position: number;
};

const DEFAULT_SIZE_OPTIONS: Array<
  Omit<SizeOption, "id"> & { id: string | null }
> = [
  { id: null, label: "Small", scalePercent: 50, priceDelta: "0", position: 0 },
  { id: null, label: "Medium", scalePercent: 75, priceDelta: "0", position: 1 },
  { id: null, label: "Large", scalePercent: 100, priceDelta: "0", position: 2 },
];

function requireShop(shop: string) {
  const normalized = shop.trim();

  if (!normalized) {
    throw new Error("Shop is required.");
  }

  return normalized;
}

/**
 * Returns the shop's saved size list, or a built-in Small/Medium/Large
 * default when nothing's been saved yet — so publishing always creates
 * multiple variants without requiring setup first. The default is never
 * persisted; it's regenerated on every call until the merchant actually
 * saves something.
 */
export async function getSizeOptions(shop: string): Promise<SizeOption[]> {
  const normalizedShop = requireShop(shop);

  const saved = await prisma.shopSizeOption.findMany({
    where: { shop: normalizedShop },
    orderBy: { position: "asc" },
  });

  if (saved.length === 0) {
    return DEFAULT_SIZE_OPTIONS.map((option, index) => ({
      ...option,
      id: `default-${index}`,
    }));
  }

  return saved.map((option) => ({
    id: option.id,
    label: option.label,
    scalePercent: option.scalePercent,
    priceDelta: option.priceDelta.toString(),
    position: option.position,
  }));
}

export type SaveSizeOptionInput = {
  id?: string;
  label: string;
  scalePercent: number;
  priceDelta: string;
};

export async function saveSizeOptions(
  shop: string,
  inputs: SaveSizeOptionInput[],
): Promise<void> {
  const normalizedShop = requireShop(shop);

  if (inputs.length === 0) {
    throw new Error("Keep at least one print size.");
  }

  const labels = new Set<string>();

  for (const input of inputs) {
    const label = input.label.trim();

    if (!label) {
      throw new Error("Every print size needs a name.");
    }

    if (labels.has(label.toLowerCase())) {
      throw new Error("Print size names must be unique.");
    }

    labels.add(label.toLowerCase());

    if (
      !Number.isInteger(input.scalePercent) ||
      input.scalePercent < 1 ||
      input.scalePercent > 100
    ) {
      throw new Error("Print size scale must be between 1 and 100%.");
    }

    const priceDelta = Number(input.priceDelta);

    if (!Number.isFinite(priceDelta)) {
      throw new Error("Print size price adjustment must be a valid number.");
    }
  }

  if (!inputs.some((input) => input.scalePercent === 100)) {
    throw new Error("Keep at least one print size at 100% (the original resolution).");
  }

  // Existing rows are updated in place by id, not deleted and
  // recreated — Style.productSettings.sizeVariants matches Shopify
  // variants against this same id on republish (see
  // style-publish.server.ts), so a fresh id here would make every
  // save-settings action orphan and duplicate every published
  // product's size variants.
  await prisma.$transaction(async (tx) => {
    const existing = await tx.shopSizeOption.findMany({
      where: { shop: normalizedShop },
      select: { id: true },
    });

    const keptIds = new Set(
      inputs
        .map((input) => input.id)
        .filter((id): id is string => typeof id === "string"),
    );

    const removedIds = existing
      .map((row) => row.id)
      .filter((id) => !keptIds.has(id));

    if (removedIds.length > 0) {
      await tx.shopSizeOption.deleteMany({
        where: { id: { in: removedIds } },
      });
    }

    for (const [index, input] of inputs.entries()) {
      const data = {
        shop: normalizedShop,
        label: input.label.trim(),
        scalePercent: input.scalePercent,
        priceDelta: input.priceDelta,
        position: index,
      };

      if (input.id) {
        await tx.shopSizeOption.update({
          where: { id: input.id },
          data,
        });
      } else {
        await tx.shopSizeOption.create({ data });
      }
    }
  });
}
