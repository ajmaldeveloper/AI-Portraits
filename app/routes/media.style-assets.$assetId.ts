import type { LoaderFunctionArgs } from "react-router";
import sharp from "sharp";

import { verifySignedStyleAssetRequest } from "../services/media/media-signing.server";
import { getStyleAssetBinary } from "../services/styles/style-product-media.server";

// A flat mat + solid frame border, proportional to the image's own
// width so it scales sensibly across print sizes — deliberately not
// the beveled-gradient look the storefront CSS preview uses (a real
// deliverable file shouldn't carry a fake drop shadow or gradient,
// which only make sense as an on-screen mockup convention).
function hexToRgb(hex: string) {
  const value = Number.parseInt(hex, 16);

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

async function applyFrame(
  pipeline: ReturnType<typeof sharp>,
  frameHex: string,
) {
  const metadata = await pipeline.metadata();

  const baseWidth = metadata.width ?? 1024;

  const matThickness = Math.max(8, Math.round(baseWidth * 0.035));

  const borderThickness = Math.max(14, Math.round(baseWidth * 0.05));

  // sharp's .extend() doesn't stack across chained calls on the same
  // pipeline — the second call's config replaces the first's rather
  // than adding to it — so the mat has to be materialized to a buffer
  // before the frame border extend runs on a fresh pipeline.
  const withMat = await pipeline
    .extend({
      top: matThickness,
      bottom: matThickness,
      left: matThickness,
      right: matThickness,
      background: { r: 250, g: 248, b: 244 },
    })
    .toBuffer();

  return sharp(withMat).extend({
    top: borderThickness,
    bottom: borderThickness,
    left: borderThickness,
    right: borderThickness,
    background: hexToRgb(frameHex),
  });
}

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

  const scaleRaw = url.searchParams.get("scale");

  const frame = url.searchParams.get("frame") ?? "";

  const signature = url.searchParams.get("signature");

  if (!shop || !expiresRaw || !signature) {
    return new Response("Invalid media URL.", {
      status: 403,
    });
  }

  const expires = Number(expiresRaw);

  // Absent scale means "full resolution" for URLs signed before sizing
  // existed — verifySignedStyleAssetRequest still requires whatever
  // value is checked here to match what was actually signed.
  const scale = scaleRaw === null ? 100 : Number(scaleRaw);

  const valid = verifySignedStyleAssetRequest({
    assetId,
    shop,
    expires,
    scale,
    frame,
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

  const contentType = asset.mimeType || "application/octet-stream";

  const extension = contentType.startsWith("image/")
    ? contentType.slice("image/".length).split("+")[0]
    : "bin";

  // Content is deterministic per assetId+scale — assets are never
  // mutated after creation (only created/deleted) — so this is safe to
  // cache aggressively. The URL is already HMAC-signed, so caching
  // publicly doesn't leak anything a bearer of the URL couldn't already
  // fetch directly.
  //
  // Content-Disposition: attachment only affects a direct top-level
  // navigation to this URL (e.g. clicking the "See your artwork" cart
  // line item link) — it's ignored for the same URL used as an <img
  // src>, which is how the storefront itself renders it — so this is
  // safe to set unconditionally rather than needing a separate
  // download-only endpoint.
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `attachment; filename="artwork-${assetId}.${extension}"`,
  };

  const isImage = contentType.startsWith("image/");

  if ((scale >= 100 && !frame) || !isImage) {
    /*
     * getStyleAssetBinary returns a non-null, ArrayBuffer-backed
     * Uint8Array. Use the underlying sliced ArrayBuffer as the Response
     * body to avoid typed-array generic differences in TypeScript 5.9.
     */
    const body = asset.binaryData.buffer.slice(
      asset.binaryData.byteOffset,
      asset.binaryData.byteOffset + asset.binaryData.byteLength,
    );

    return new Response(body, { headers });
  }

  let pipeline = sharp(asset.binaryData);

  if (scale < 100) {
    const metadata = await pipeline.metadata();

    const nativeWidth = metadata.width ?? 0;

    const targetWidth = Math.max(1, Math.round((nativeWidth * scale) / 100));

    pipeline = sharp(await pipeline.resize({ width: targetWidth }).toBuffer());
  }

  if (frame) {
    pipeline = await applyFrame(pipeline, frame);
  }

  const output = await pipeline.toBuffer();

  return new Response(output, { headers });
};
