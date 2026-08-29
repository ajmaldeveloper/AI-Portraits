import prisma from "../../db.server";
import { requireStyleForShop, styleCanBeEdited } from "./style.server";

// Per-style Framing variants, configured on the Product tab — see
// StyleFramingOption in schema.prisma. Priced as a delta on top of
// whichever Size the customer picks (or the Style's flat basePrice if
// no sizes exist), not an absolute price. An empty list is valid — no
// framing offered, matching how an empty Size list means "single-size."

export type SaveStyleFramingOptionInput = {
  id?: string;
  label: string;
  priceDelta: string;
  compareAtPriceDelta: string | null;
  requiresShipping: boolean;
};

export async function saveStyleFramingOptions(
  shop: string,
  styleId: string,
  inputs: SaveStyleFramingOptionInput[],
): Promise<void> {
  const style = await requireStyleForShop(shop, styleId);

  if (!styleCanBeEdited(style)) {
    throw new Error(
      `Framing options cannot be changed while the style status is ${style.status}.`,
    );
  }

  const labels = new Set<string>();

  const decimalPattern = /^-?\d+(?:\.\d{1,2})?$/;

  for (const input of inputs) {
    const label = input.label.trim();

    if (!label) {
      throw new Error("Every framing option needs a name.");
    }

    if (labels.has(label.toLowerCase())) {
      throw new Error("Framing option names must be unique.");
    }

    labels.add(label.toLowerCase());

    if (!decimalPattern.test(input.priceDelta)) {
      throw new Error(
        "Framing price adjustment must be a valid number with up to two decimal places.",
      );
    }

    if (
      input.compareAtPriceDelta &&
      !decimalPattern.test(input.compareAtPriceDelta)
    ) {
      throw new Error(
        "Framing compare-at adjustment must be a valid number with up to two decimal places.",
      );
    }
  }

  // Existing rows are updated in place by id, not deleted and
  // recreated — Style.productSettings.sizeVariants matches Shopify
  // variants against this same id (as part of a composite key with
  // any Size option) on republish, so a fresh id here would orphan and
  // duplicate this product's already-published variants.
  await prisma.$transaction(async (tx) => {
    const existing = await tx.styleFramingOption.findMany({
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
      await tx.styleFramingOption.deleteMany({
        where: { id: { in: removedIds } },
      });
    }

    for (const [index, input] of inputs.entries()) {
      const data = {
        styleId,
        label: input.label.trim(),
        priceDelta: input.priceDelta,
        compareAtPriceDelta: input.compareAtPriceDelta,
        requiresShipping: input.requiresShipping,
        position: index,
      };

      if (input.id) {
        await tx.styleFramingOption.update({
          where: { id: input.id },
          data,
        });
      } else {
        await tx.styleFramingOption.create({ data });
      }
    }
  });
}
