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

// scale (and, when requested, frame) are folded into the signed
// message so a URL signed for one can't be replayed to request a
// different one — see media.style-assets.$assetId.ts, which resizes
// on read when scale < 100 and composites a mat + frame border onto
// the image when frame is present. frame is a bare 6-digit hex (no
// "#" — kept out of the message/URL punctuation) or "" for none.
function message(
  assetId: string,
  shop: string,
  expires: number,
  scale: number,
  frame: string,
) {
  return [assetId, shop, String(expires), String(scale), frame].join("\n");
}

function signature(
  assetId: string,
  shop: string,
  expires: number,
  scale: number,
  frame: string,
) {
  return createHmac("sha256", signingSecret())
    .update(message(assetId, shop, expires, scale, frame))
    .digest("hex");
}

export function createSignedStyleAssetUrl(
  requestUrl: string,
  assetId: string,
  shop: string,
  ttlSeconds = 60 * 60 * 6,
  scalePercent = 100,
  frameColor?: string | null,
) {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;

  const origin = new URL(requestUrl).origin;

  const url = new URL(
    `/media/style-assets/${encodeURIComponent(assetId)}`,
    origin,
  );

  const frame = frameColor?.replace(/^#/, "").toLowerCase() ?? "";

  url.searchParams.set("shop", shop);

  url.searchParams.set("expires", String(expires));

  url.searchParams.set("scale", String(scalePercent));

  if (frame) {
    url.searchParams.set("frame", frame);
  }

  url.searchParams.set(
    "signature",
    signature(assetId, shop, expires, scalePercent, frame),
  );

  return url.toString();
}

export function verifySignedStyleAssetRequest(input: {
  assetId: string;
  shop: string;
  expires: number;
  scale: number;
  frame: string;
  signature: string;
}) {
  if (!Number.isInteger(input.expires)) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);

  if (input.expires <= now) {
    return false;
  }

  // Above 100 upscales (see media.style-assets.$assetId.ts) — capped
  // at 400 to match the ceiling style-size-options.server.ts enforces
  // on StyleSizeOption.scalePercent.
  if (
    !Number.isInteger(input.scale) ||
    input.scale < 1 ||
    input.scale > 400
  ) {
    return false;
  }

  if (input.frame && !/^[0-9a-f]{6}$/i.test(input.frame)) {
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
    input.frame.toLowerCase(),
  );

  const suppliedBuffer = Buffer.from(input.signature, "hex");

  const expectedBuffer = Buffer.from(expected, "hex");

  if (suppliedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(suppliedBuffer, expectedBuffer);
}
