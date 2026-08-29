import type { LoaderFunctionArgs } from "react-router";

import { createSignedStyleAssetUrl } from "../services/media/media-signing.server";
import { getCustomerGenerationStatus } from "../services/customer/customer-generation.server";
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

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);

  if (!session) {
    return jsonError("Could not authenticate this storefront request.", 401);
  }

  const generationId = params.generationId;

  if (!generationId) {
    return jsonError("A generation ID is required.", 400);
  }

  const status = await getCustomerGenerationStatus(session.shop, generationId);

  if (!status) {
    return jsonError("Generation not found.", 404);
  }

  const resultUrl = status.resultAssetId
    ? createSignedStyleAssetUrl(request.url, status.resultAssetId, session.shop)
    : null;

  return Response.json(
    {
      ok: true,
      status: status.status,
      errorMessage: status.errorMessage,
      resultUrl,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
};
