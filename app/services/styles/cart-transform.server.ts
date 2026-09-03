import { authenticate } from "../../shopify.server";

type AdminGraphqlClient = Awaited<
  ReturnType<typeof authenticate.admin>
>["admin"];

// Must match extensions/ai-art-generator-price-transform/shopify.extension.toml's
// own `handle`.
export const AI_ART_GENERATOR_CART_TRANSFORM_HANDLE =
  "ai-art-generator-price-transform";

export type CartTransformStatus = {
  connected: boolean;
  id: string | null;
  functionId: string | null;
  error: string | null;
};

type CartTransformNode = {
  id: string;
  functionId: string;
};

const disconnected = (error: string | null = null): CartTransformStatus => ({
  connected: false,
  id: null,
  functionId: null,
  error,
});

export async function getCartTransformStatus(
  admin: AdminGraphqlClient,
): Promise<CartTransformStatus> {
  try {
    const response = await admin.graphql(
      `#graphql
        query AiArtGeneratorCartTransforms {
          cartTransforms(first: 10) {
            nodes {
              id
              functionId
            }
          }
        }
      `,
    );

    const payload = (await response.json()) as {
      data?: { cartTransforms?: { nodes?: CartTransformNode[] } };
      errors?: Array<{ message?: string }>;
    };

    if (payload.errors?.length) {
      return disconnected(
        payload.errors[0]?.message ?? "Unable to read Cart Transform status.",
      );
    }

    const node = payload.data?.cartTransforms?.nodes?.[0];

    if (!node) {
      return disconnected();
    }

    return {
      connected: true,
      id: node.id,
      functionId: node.functionId,
      error: null,
    };
  } catch {
    return disconnected("Cart Transform permission is not available yet.");
  }
}

/**
 * Idempotent — returns the existing Cart Transform if one is already
 * connected, otherwise creates it. Shopify allows only one Cart
 * Transform per function per shop, so this is safe to call on every
 * pricing sync.
 */
export async function connectCartTransform(
  admin: AdminGraphqlClient,
): Promise<
  | { ok: true; status: CartTransformStatus }
  | { ok: false; message: string; status: CartTransformStatus }
> {
  const existing = await getCartTransformStatus(admin);

  if (existing.connected) {
    return { ok: true, status: existing };
  }

  try {
    const response = await admin.graphql(
      `#graphql
        mutation AiArtGeneratorCartTransformCreate($functionHandle: String!) {
          cartTransformCreate(
            functionHandle: $functionHandle
            blockOnFailure: false
          ) {
            cartTransform {
              id
              functionId
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: { functionHandle: AI_ART_GENERATOR_CART_TRANSFORM_HANDLE },
      },
    );

    const payload = (await response.json()) as {
      data?: {
        cartTransformCreate?: {
          cartTransform?: CartTransformNode | null;
          userErrors?: Array<{ message: string }>;
        };
      };
      errors?: Array<{ message?: string }>;
    };

    const mutation = payload.data?.cartTransformCreate;

    const message =
      mutation?.userErrors?.[0]?.message ?? payload.errors?.[0]?.message;

    if (message) {
      return { ok: false, message, status: existing };
    }

    const node = mutation?.cartTransform;

    if (!node) {
      return {
        ok: false,
        message: "Shopify did not return a Cart Transform after setup.",
        status: existing,
      };
    }

    return {
      ok: true,
      status: {
        connected: true,
        id: node.id,
        functionId: node.functionId,
        error: null,
      },
    };
  } catch {
    return {
      ok: false,
      message:
        "Unable to connect Shopify pricing. Restart app dev, approve the new Cart Transform scopes, then try again.",
      status: existing,
    };
  }
}
