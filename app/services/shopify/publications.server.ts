import { authenticate } from "../../shopify.server";

type AdminGraphqlClient = Awaited<
  ReturnType<typeof authenticate.admin>
>["admin"];

type PublicationsResponse = {
  data?: {
    publications?: {
      nodes: Array<{
        id: string;
        name: string | null;
        catalog: {
          title: string;
        } | null;
      }>;
    };
  };
  errors?: Array<{ message: string }>;
};

const PUBLICATIONS_QUERY = `#graphql
  query StylePublishFindOnlineStorePublication {
    publications(first: 20) {
      nodes {
        id
        name
        catalog {
          title
        }
      }
    }
  }
`;

/**
 * Resolves the "Online Store" sales channel publication ID.
 *
 * Every shop has this publication by default. The Online Store channel's
 * `catalog` field can come back null (catalogs are really for B2B/market/
 * app channels, not the built-in one), so catalog.title alone isn't a
 * reliable match here — this also falls back to the deprecated but still
 * queryable Publication.name field, which is the one the built-in
 * channel has reliably always used.
 */
export async function findOnlineStorePublicationId(
  admin: AdminGraphqlClient,
): Promise<string> {
  const response = await admin.graphql(PUBLICATIONS_QUERY);

  const payload = (await response.json()) as PublicationsResponse;

  if (payload.errors && payload.errors.length > 0) {
    throw new Error(payload.errors.map((error) => error.message).join(" "));
  }

  const nodes = payload.data?.publications?.nodes ?? [];

  const onlineStore = nodes.find(
    (node) =>
      node.catalog?.title === "Online Store" || node.name === "Online Store",
  );

  if (!onlineStore) {
    throw new Error(
      "Could not find the Online Store sales channel for this shop.",
    );
  }

  return onlineStore.id;
}
