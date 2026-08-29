import prisma from "../../db.server";
import { requireStyleForShop, styleCanBeEdited } from "./style.server";

// Per-style print/download size variants, configured on the Product
// tab — see StyleSizeOption in schema.prisma. An empty list means the
// product stays single-variant at publish time (style-publish.server.ts);
// a merchant opts into sizing by adding rows here.

export type SaveStyleSizeOptionInput = {
  id?: string;
  label: string;
  scalePercent: number;
  price: string;
  compareAtPrice: string | null;
};

export async function saveStyleSizeOptions(
  shop: string,
  styleId: string,
  inputs: SaveStyleSizeOptionInput[],
): Promise<void> {
  const style = await requireStyleForShop(shop, styleId);

  if (!styleCanBeEdited(style)) {
    throw new Error(
      `Sizes cannot be changed while the style status is ${style.status}.`,
    );
  }

  const labels = new Set<string>();

  for (const input of inputs) {
    const label = input.label.trim();

    if (!label) {
      throw new Error("Every size needs a name.");
    }

    if (labels.has(label.toLowerCase())) {
      throw new Error("Size names must be unique.");
    }

    labels.add(label.toLowerCase());

    if (
      !Number.isInteger(input.scalePercent) ||
      input.scalePercent < 1 ||
      input.scalePercent > 100
    ) {
      throw new Error("Size scale must be between 1 and 100%.");
    }

    if (!/^\d+(?:\.\d{1,2})?$/.test(input.price)) {
      throw new Error(
        "Size price must be a non-negative number with up to two decimal places.",
      );
    }

    if (
      input.compareAtPrice &&
      !/^\d+(?:\.\d{1,2})?$/.test(input.compareAtPrice)
    ) {
      throw new Error(
        "Size compare-at price must be a non-negative number with up to two decimal places.",
      );
    }
  }

  if (
    inputs.length > 0 &&
    !inputs.some((input) => input.scalePercent === 100)
  ) {
    throw new Error("Keep at least one size at 100% (the original resolution).");
  }

  // Existing rows are updated in place by id, not deleted and
  // recreated — Style.productSettings.sizeVariants matches Shopify
  // variants against this same id on republish (see
  // style-publish.server.ts), so a fresh id here would orphan and
  // duplicate this product's already-published size variants.
  await prisma.$transaction(async (tx) => {
    const existing = await tx.styleSizeOption.findMany({
      where: { styleId },
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
      await tx.styleSizeOption.deleteMany({
        where: { id: { in: removedIds } },
      });
    }

    for (const [index, input] of inputs.entries()) {
      const data = {
        styleId,
        label: input.label.trim(),
        scalePercent: input.scalePercent,
        price: input.price,
        compareAtPrice: input.compareAtPrice,
        position: index,
      };

      if (input.id) {
        await tx.styleSizeOption.update({
          where: { id: input.id },
          data,
        });
      } else {
        await tx.styleSizeOption.create({ data });
      }
    }
  });
}
