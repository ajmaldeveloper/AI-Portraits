import type { LoaderFunctionArgs } from "react-router";

import { createSignedStyleAssetUrl } from "../services/media/media-signing.server";
import { getCustomerGenerationStatus } from "../services/customer/customer-generation.server";
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

  // One signed URL per configured print size, all pointing at the same
  // stored asset with a different `scale` — see
  // media.style-assets.$assetId.ts, which resizes on read. resultUrl is
  // kept for backward compatibility with any cached storefront JS
  // still expecting the old flat shape; it's always the largest size.
  let resultUrls: Record<string, string> = {};

  let resultUrl: string | null = null;

  if (status.resultAssetId) {
    const style = await requireStyleForShop(session.shop, status.styleId);

    // The SIZE-axis option's own choices — resolving directly off the
    // live Style data (not a publish-time snapshot) means a size added
    // after the last publish is still available here immediately,
    // without needing a republish first.
    const sizeOption = style.options.find((option) => option.axisRole === "SIZE");

    const sizeChoices = (sizeOption?.choices ?? [])
      .filter((choice) => choice.scalePercent !== null)
      .map((choice) => ({
        label: choice.label,
        scalePercent: choice.scalePercent as number,
      }));

    resultUrls = Object.fromEntries(
      sizeChoices.map((entry) => [
        entry.label,
        createSignedStyleAssetUrl(
          request.url,
          status.resultAssetId as string,
          session.shop,
          undefined,
          entry.scalePercent,
        ),
      ]),
    );

    const largest = sizeChoices.reduce<(typeof sizeChoices)[number] | null>(
      (best, entry) =>
        !best || entry.scalePercent > best.scalePercent ? entry : best,
      null,
    );

    resultUrl = largest
      ? resultUrls[largest.label]
      : createSignedStyleAssetUrl(
          request.url,
          status.resultAssetId,
          session.shop,
        );
  }

  // A low-res in-progress preview (see editOpenAIImage's onPartialImage
  // / markGenerationPartial) — only ever set while status is
  // PROCESSING, so the storefront's poll loop can show it sharpening
  // instead of a bare spinner. No per-size scaling needed here, unlike
  // resultUrls — it's a rough preview, not something ordered.
  const partialUrl = status.partialAssetId
    ? createSignedStyleAssetUrl(request.url, status.partialAssetId, session.shop)
    : null;

  return Response.json(
    {
      ok: true,
      status: status.status,
      errorMessage: status.errorMessage,
      resultUrl,
      resultUrls,
      partialUrl,
      partialIndex: status.partialIndex,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
};
