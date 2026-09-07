import type { LoaderFunctionArgs } from "react-router";

import { listCustomerGenerations } from "../services/customer/customer-generation.server";
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

// A logged-in customer's own past generations for this Style, so
// their history follows them across devices/browsers instead of only
// living in one browser's localStorage (see ai-art-generator.js's own
// loadHistory/saveHistory, which still covers a guest). Always
// succeeds with an empty list for a guest — there's simply nowhere to
// look their generations up from, not an error.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);

  if (!session) {
    return jsonError("Could not authenticate this storefront request.", 401);
  }

  const styleId = params.styleId;

  if (!styleId) {
    return jsonError("A style ID is required.", 400);
  }

  const customerId = new URL(request.url).searchParams.get(
    "logged_in_customer_id",
  );

  if (!customerId) {
    return Response.json(
      { ok: true, generations: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const generations = await listCustomerGenerations(
    session.shop,
    styleId,
    customerId,
  );

  return Response.json(
    {
      ok: true,
      generations: generations.map((generation) => ({
        id: generation.id,
        createdAt: generation.createdAt.toISOString(),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
};
