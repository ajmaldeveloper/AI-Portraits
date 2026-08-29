import type { LoaderFunctionArgs } from "react-router";

import {
  buildStyleExport,
  styleExportFilename,
} from "../services/styles/style-export.server";
import { authenticate } from "../shopify.server";

// A plain resource route (JSON response with a Content-Disposition
// header) rather than an action — a normal link click triggers the
// browser's native file-download UI, no client-side JS needed.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const styleId = params.styleId;

  if (!styleId) {
    throw new Response("Style ID is required", { status: 400 });
  }

  const payload = await buildStyleExport(session.shop, styleId);

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${styleExportFilename(payload.style.name)}"`,
      "Cache-Control": "no-store",
    },
  });
};
