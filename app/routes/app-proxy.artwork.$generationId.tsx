import type { LoaderFunctionArgs } from "react-router";

import { createSignedStyleAssetUrl } from "../services/media/media-signing.server";
import { getCustomerGenerationStatus } from "../services/customer/customer-generation.server";
import { authenticate } from "../shopify.server";

// A short, stable, human-presentable redirect to a generation's result
// image — used as the cart line item property value instead of the
// long signed media URL directly (query string, HMAC signature, and
// all), which is what a customer would otherwise see pasted as plain
// text in their cart. Redirects (not proxies) straight to the signed
// URL, which itself serves with Content-Disposition: attachment.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);

  if (!session) {
    return new Response("Could not authenticate this storefront request.", {
      status: 401,
    });
  }

  const generationId = params.generationId;

  if (!generationId) {
    return new Response("A generation ID is required.", { status: 400 });
  }

  const status = await getCustomerGenerationStatus(session.shop, generationId);

  if (!status?.resultAssetId) {
    return new Response("Artwork not found.", { status: 404 });
  }

  // Optional — set by the storefront JS from the Framing option that
  // was actually selected at add-to-cart time, so the linked image
  // matches what was ordered (a mat + solid frame border composited
  // on read, not baked into the stored asset — see
  // media.style-assets.$assetId.ts). Only ever changes what this one
  // link's own copy looks like, never the order's real Framing
  // variant/price, so it's fine for the client to specify directly.
  const frameParam = new URL(request.url).searchParams.get("frame");

  const frame =
    frameParam && /^[0-9a-f]{6}$/i.test(frameParam) ? frameParam : null;

  const signedUrl = createSignedStyleAssetUrl(
    request.url,
    status.resultAssetId,
    session.shop,
    undefined,
    100,
    frame,
  );

  return new Response(null, {
    status: 302,
    headers: {
      Location: signedUrl,
      "Cache-Control": "no-store",
    },
  });
};
