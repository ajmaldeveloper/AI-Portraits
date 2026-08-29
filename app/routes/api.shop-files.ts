import type { LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";

const SHOP_IMAGE_FILES_QUERY = `#graphql
  query StyleShopImageFiles {
    files(first: 50, query: "media_type:IMAGE", sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        alt
        preview {
          image {
            url
          }
        }
      }
    }
  }
`;

/**
 * Shopify's MediaImage type has no filename field — only `alt`, which is
 * usually empty for files a merchant never captioned. The CDN url still
 * carries the real original filename in its path, so this derives a
 * genuine label from that instead of a repeated generic fallback.
 */
function labelFromUrl(url: string): string {
  try {
    const lastSegment = new URL(url).pathname.split("/").pop() ?? "";

    const withoutExtension = lastSegment.replace(/\.[a-zA-Z0-9]+$/, "");

    return decodeURIComponent(withoutExtension).replace(/[-_]+/g, " ").trim();
  } catch {
    return "";
  }
}

/**
 * Backs the "Select existing" picker on the Media tab — lists the
 * shop's own already-uploaded image files (Content > Files in Admin) so
 * a merchant can reuse an existing asset instead of always uploading a
 * brand new one from their device.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(SHOP_IMAGE_FILES_QUERY);

  const result = (await response.json()) as {
    data?: {
      files?: {
        nodes?: Array<{
          id: string;
          alt: string | null;
          preview: {
            image: {
              url: string;
            } | null;
          } | null;
        }>;
      };
    };
  };

  const files = (result.data?.files?.nodes ?? [])
    .filter((file) => file.preview?.image?.url)
    .map((file) => {
      const url = file.preview!.image!.url;

      return {
        id: file.id,
        url,
        alt: file.alt,
        label: file.alt || labelFromUrl(url) || "Image",
      };
    });

  return Response.json({ files });
};
