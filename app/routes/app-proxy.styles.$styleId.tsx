import type { LoaderFunctionArgs } from "react-router";

import { createSignedStyleAssetUrl } from "../services/media/media-signing.server";
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
      basePrice: style.basePrice.toString(),

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

      // Every Product option this Style has — the storefront extension
      // renders ALL of these itself (the Shopify product behind this
      // Style is always a plain single-variant product; there's no
      // native variant picker to lean on). Any option's choices may
      // carry pricing (priceDelta/compareAtPriceDelta, null = no
      // charge) that the storefront sums into a running total,
      // matching what the ai-art-generator-price-transform Cart
      // Transform Function will actually charge at checkout — see
      // style-pricing-sync.server.ts, the single source of truth this
      // mirrors. axisRole "SIZE" additionally drives which resolution
      // to request for the result image (scalePercent) and holds each
      // size's own absolute price rather than a delta; axisRole
      // "FRAMING" additionally drives the visual frame preview
      // (hexColor/imageUrl/thickness/mat/radius) and whether the
      // order needs physical shipping. imageUrl is available on any
      // choice, any axis — a plain reference photo everywhere except
      // Framing, where it doubles as an uploaded frame texture.
      options: style.options.map((option) => ({
        id: option.id,
        label: option.label,
        type: option.type,
        axisRole: option.axisRole,
        imageOrientation: option.imageOrientation,
        imageFit: option.imageFit,
        choices: option.choices.map((choice) => ({
          id: choice.id,
          label: choice.label,
          priceDelta: choice.priceDelta?.toString() ?? null,
          compareAtPriceDelta: choice.compareAtPriceDelta?.toString() ?? null,
          requiresShipping: choice.requiresShipping,
          scalePercent: choice.scalePercent,
          hexColor: choice.hexColor,
          imageUrl: choice.imageAssetId
            ? createSignedStyleAssetUrl(
                request.url,
                choice.imageAssetId,
                session.shop,
              )
            : null,
          borderThicknessPx: choice.borderThicknessPx,
          matThicknessPx: choice.matThicknessPx,
          borderRadiusPx: choice.borderRadiusPx,
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
