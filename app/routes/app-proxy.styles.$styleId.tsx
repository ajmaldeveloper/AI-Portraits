import type { LoaderFunctionArgs } from "react-router";

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
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
};
