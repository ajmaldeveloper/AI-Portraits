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

function message(assetId: string, shop: string, expires: number) {
  return [assetId, shop, String(expires)].join("\n");
}

function signature(assetId: string, shop: string, expires: number) {
  return createHmac("sha256", signingSecret())
    .update(message(assetId, shop, expires))
    .digest("hex");
}

export function createSignedStyleAssetUrl(
  requestUrl: string,
  assetId: string,
  shop: string,
  ttlSeconds = 60 * 60 * 6,
) {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;

  const origin = new URL(requestUrl).origin;

  const url = new URL(
    `/media/style-assets/${encodeURIComponent(assetId)}`,
    origin,
  );

  url.searchParams.set("shop", shop);

  url.searchParams.set("expires", String(expires));

  url.searchParams.set("signature", signature(assetId, shop, expires));

  return url.toString();
}

export function verifySignedStyleAssetRequest(input: {
  assetId: string;
  shop: string;
  expires: number;
  signature: string;
}) {
  if (!Number.isInteger(input.expires)) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);

  if (input.expires <= now) {
    return false;
  }

  if (!/^[a-f0-9]{64}$/i.test(input.signature)) {
    return false;
  }

  const expected = signature(input.assetId, input.shop, input.expires);

  const suppliedBuffer = Buffer.from(input.signature, "hex");

  const expectedBuffer = Buffer.from(expected, "hex");

  if (suppliedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(suppliedBuffer, expectedBuffer);
}
