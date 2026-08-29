import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  buildStylesExportBundle,
  stylesExportBundleFilename,
} from "../services/styles/style-export.server";
import { authenticate } from "../shopify.server";

// Bulk export — same idea as the single-style export route, but for
// however many style ids are selected on the Styles list page.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const url = new URL(request.url);

  const ids = url.searchParams
    .get("ids")
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!ids || ids.length === 0) {
    throw new Response("At least one style ID is required", { status: 400 });
  }

  const payload = await buildStylesExportBundle(session.shop, ids);

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${stylesExportBundleFilename(session.shop)}"`,
      "Cache-Control": "no-store",
    },
  });
};

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
