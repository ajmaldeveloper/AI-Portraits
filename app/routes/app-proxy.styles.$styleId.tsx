import type { LoaderFunctionArgs } from "react-router";

import { parseSizeVariants } from "../services/styles/style-publish.server";
import { requireStyleForShop } from "../services/styles/style.server";
import { authenticate } from "../shopify.server";

function jsonError(message: string, status: number) {
  return Response.json(
    {
      ok: false,
      error: message,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);

  if (!session) {
    return jsonError("Could not authenticate this storefront request.", 401);
  }

  const styleId = params.styleId;

  if (!styleId) {
    return jsonError("A style ID is required.", 400);
  }

  let style;

  try {
    style = await requireStyleForShop(session.shop, styleId);
  } catch {
    return jsonError("Style not found.", 404);
  }

  if (style.status !== "PUBLISHED") {
    return jsonError(
      "This product isn't available for personalization right now.",
      404,
    );
  }

  return Response.json(
    {
      ok: true,

      styleId: style.id,
      name: style.name,

      // Only what the storefront form needs to render itself — never
      // the transformation prompt, which is proprietary to the
      // merchant.
      fields: style.fields.map((field) => ({
        id: field.id,
        key: field.key,
        label: field.label,
        type: field.type,
        required: field.required,
        placeholder: field.placeholder,
        helpText: field.helpText,
        defaultValue: field.defaultValue,
        options: stringArray(field.options),
      })),

      // Lets the storefront match the theme's native variant picker
      // back to the right result-image URL from resultUrls (see
      // app-proxy.generations.$generationId.tsx) — numericVariantId
      // matches what the cart form's own "id" field submits.
      // frameColor/frameImageUrl (both null when this variant has no
      // visual frame, e.g. a "No Frame" choice) drive the storefront's
      // CSS border — see SizeVariantMapping's own comment for where
      // they come from. A variant carries at most one of the two —
      // whichever the Framing-axis choice's own type set.
      variantOptions: parseSizeVariants(style.productSettings).map((entry) => ({
        variantId: entry.numericVariantId,
        label: entry.label,
        scalePercent: entry.scalePercent,
        frameColor: entry.frameColor,
        frameImageUrl: entry.frameImageUrl,
        borderThicknessPx: entry.borderThicknessPx,
        matThicknessPx: entry.matThicknessPx,
        borderRadiusPx: entry.borderRadiusPx,
      })),

      // Independent of Framing's own Shopify variants — any EXTRA
      // option choice combines with any Framing choice — so these come
      // straight from the Style's own relations, not the publish-time
      // sizeVariants mapping, and stay current even before a
      // republish. One entry per role: EXTRA StyleOption (Mat color is
      // just whichever one a merchant has set up).
      extraOptions: style.options
        .filter((option) => option.role === "EXTRA")
        .map((option) => ({
          label: option.label,
          choices: option.choices.map((choice) => ({
            label: choice.label,
            hexColor: choice.hexColor,
          })),
        })),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
};
