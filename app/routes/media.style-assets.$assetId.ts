import type { LoaderFunctionArgs } from "react-router";

import { verifySignedStyleAssetRequest } from "../services/media/media-signing.server";
import { getStyleAssetBinary } from "../services/styles/style-product-media.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const assetId = params.assetId;

  if (!assetId) {
    return new Response("Asset ID is required.", {
      status: 400,
    });
  }

  const url = new URL(request.url);

  const shop = url.searchParams.get("shop");

  const expiresRaw = url.searchParams.get("expires");

  const signature = url.searchParams.get("signature");

  if (!shop || !expiresRaw || !signature) {
    return new Response("Invalid media URL.", {
      status: 403,
    });
  }

  const expires = Number(expiresRaw);

  const valid = verifySignedStyleAssetRequest({
    assetId,
    shop,
    expires,
    signature,
  });

  if (!valid) {
    return new Response("Media URL has expired or is invalid.", {
      status: 403,
    });
  }

  const asset = await getStyleAssetBinary(shop, assetId);

  if (!asset) {
    return new Response("Image not found.", {
      status: 404,
    });
  }

  /*
   * getStyleAssetBinary returns a non-null, ArrayBuffer-backed
   * Uint8Array. Use the underlying sliced ArrayBuffer as the Response
   * body to avoid typed-array generic differences in TypeScript 5.9.
   */
  const body = asset.binaryData.buffer.slice(
    asset.binaryData.byteOffset,
    asset.binaryData.byteOffset + asset.binaryData.byteLength,
  );

  return new Response(body, {
    headers: {
      "Content-Type": asset.mimeType || "application/octet-stream",

      "Cache-Control": "private, max-age=300",

      "X-Content-Type-Options": "nosniff",
    },
  });
};
