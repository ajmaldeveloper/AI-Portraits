import type { Style, StyleAsset, StyleField } from "@prisma/client";

// Centralized Style readiness logic.
//
// Overview and Publish both need to answer "is this Style ready to
// publish, and if not, where does the merchant need to go?" so the
// checklist lives here once instead of being duplicated per route.

export type StyleReadinessKey =
  "identity" | "prompt" | "customerImage" | "product" | "media";

export type StyleReadinessItem = {
  key: StyleReadinessKey;
  label: string;
  description: string;
  complete: boolean;
  section: "overview" | "fields" | "product" | "media";
};

export type StyleWithReadinessRelations = Pick<
  Style,
  "name" | "prompt" | "productTitle"
> & {
  fields: Pick<StyleField, "type">[];
  assets: Pick<StyleAsset, "kind">[];
};

export function getStyleReadiness(
  style: StyleWithReadinessRelations,
): StyleReadinessItem[] {
  const hasImageField = style.fields.some((field) => field.type === "IMAGE");

  // Every image in the gallery is product media — there's no separate
  // "select this one" step, so readiness just needs the gallery to be
  // non-empty.
  const hasMedia = style.assets.some(
    (asset) =>
      asset.kind === "PRODUCT_GENERATED" || asset.kind === "PRODUCT_SELECTED",
  );

  return [
    {
      key: "identity",
      label: "Internal name",
      description: "Give it an internal name so you can find it later.",
      complete: Boolean(style.name.trim()),
      section: "overview",
    },
    {
      key: "prompt",
      label: "AI prompt",
      description: "Describe how customer photos should be transformed.",
      complete: Boolean(style.prompt.trim()),
      section: "overview",
    },
    {
      key: "customerImage",
      label: "Photo upload field",
      description: "Let customers upload their own photo to transform.",
      complete: hasImageField,
      section: "fields",
    },
    {
      key: "product",
      label: "Product details",
      description: "Add a title, description, and price for this product.",
      complete: Boolean(style.productTitle.trim()),
      section: "product",
    },
    {
      key: "media",
      label: "Example photos",
      description: "Add at least one example image to show shoppers.",
      complete: hasMedia,
      section: "media",
    },
  ];
}

export function isStylePublishReady(
  style: StyleWithReadinessRelations,
): boolean {
  return getStyleReadiness(style).every((item) => item.complete);
}

// Media is excluded from update-readiness (unlike first-time publish,
// which does require at least one gallery image) so a merchant can
// deliberately empty the gallery via Update to clear a live product's
// media — that sync now always runs, including clearing to empty —
// without the checklist blocking the very update meant to do that.
export function isStyleUpdateReady(
  style: StyleWithReadinessRelations,
): boolean {
  return getStyleReadiness(style).every(
    (item) => item.key === "media" || item.complete,
  );
}
