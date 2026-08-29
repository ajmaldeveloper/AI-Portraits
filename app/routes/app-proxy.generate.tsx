import type { ActionFunctionArgs } from "react-router";

import {
  CustomerGenerationError,
  startCustomerGeneration,
} from "../services/customer/customer-generation.server";
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

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return jsonError("This endpoint only accepts POST requests.", 405);
  }

  const { session } = await authenticate.public.appProxy(request);

  if (!session) {
    return jsonError("Could not authenticate this storefront request.", 401);
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return jsonError("Could not read the submitted form.", 400);
  }

  const styleId = formData.get("styleId");

  if (typeof styleId !== "string" || !styleId) {
    return jsonError("A style ID is required.", 400);
  }

  const photo = formData.get("photo");

  if (!(photo instanceof File) || photo.size === 0) {
    return jsonError("Choose a photo to upload.", 400);
  }

  const fieldValuesRaw = formData.get("fieldValues");

  const fieldValues: Record<string, string> = {};

  if (typeof fieldValuesRaw === "string" && fieldValuesRaw) {
    try {
      const parsed: unknown = JSON.parse(fieldValuesRaw);

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(
          parsed as Record<string, unknown>,
        )) {
          if (typeof value === "string") {
            fieldValues[key] = value;
          }
        }
      }
    } catch {
      return jsonError("Field values were not valid.", 400);
    }
  }

  const personalizationRaw = formData.get("personalization");

  const personalization =
    typeof personalizationRaw === "string" ? personalizationRaw : "";

  try {
    const bytes = new Uint8Array(await photo.arrayBuffer());

    const result = await startCustomerGeneration(session.shop, styleId, {
      photo: {
        bytes,
        mimeType: photo.type || "application/octet-stream",
      },

      fieldValues,

      personalization,
    });

    return Response.json(
      { ok: true, generationId: result.generationId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof Response) {
      return jsonError("Style not found.", error.status);
    }

    const message =
      error instanceof CustomerGenerationError
        ? error.message
        : "Could not start image generation.";

    if (!(error instanceof CustomerGenerationError)) {
      console.error("Customer generation start failed", error);
    }

    return jsonError(message, 400);
  }
};
