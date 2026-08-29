import { createHmac, timingSafeEqual } from "node:crypto";

function signingSecret() {
  const secret =
    process.env.MEDIA_SIGNING_SECRET?.trim() ||
    process.env.SHOPIFY_API_SECRET?.trim();

  if (!secret) {
    throw new Error("Media signing secret is not configured.");
  }

  return secret;
}

// scale is folded into the signed message so a URL signed for one
// size can't be replayed to request a different one — see
// media.style-assets.$assetId.ts, which resizes on read when
// scale < 100.
function message(
  assetId: string,
  shop: string,
  expires: number,
  scale: number,
) {
  return [assetId, shop, String(expires), String(scale)].join("\n");
}

function signature(
  assetId: string,
  shop: string,
  expires: number,
  scale: number,
) {
  return createHmac("sha256", signingSecret())
    .update(message(assetId, shop, expires, scale))
    .digest("hex");
}

export function createSignedStyleAssetUrl(
  requestUrl: string,
  assetId: string,
  shop: string,
  ttlSeconds = 60 * 60 * 6,
  scalePercent = 100,
) {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;

  const origin = new URL(requestUrl).origin;

  const url = new URL(
    `/media/style-assets/${encodeURIComponent(assetId)}`,
    origin,
  );

  url.searchParams.set("shop", shop);

  url.searchParams.set("expires", String(expires));

  url.searchParams.set("scale", String(scalePercent));

  url.searchParams.set(
    "signature",
    signature(assetId, shop, expires, scalePercent),
  );

  return url.toString();
}

export function verifySignedStyleAssetRequest(input: {
  assetId: string;
  shop: string;
  expires: number;
  scale: number;
  signature: string;
}) {
  if (!Number.isInteger(input.expires)) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);

  if (input.expires <= now) {
    return false;
  }

  if (
    !Number.isInteger(input.scale) ||
    input.scale < 1 ||
    input.scale > 100
  ) {
    return false;
  }

  if (!/^[a-f0-9]{64}$/i.test(input.signature)) {
    return false;
  }

  const expected = signature(
    input.assetId,
    input.shop,
    input.expires,
    input.scale,
  );

  const suppliedBuffer = Buffer.from(input.signature, "hex");

  const expectedBuffer = Buffer.from(expected, "hex");

  if (suppliedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(suppliedBuffer, expectedBuffer);
}
