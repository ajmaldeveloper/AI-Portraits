import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  parseSizeVariants,
  publishStyleToShopify,
  unpublishStyleFromShopify,
} from "../services/styles/style-publish.server";
import { requireStyleForShop } from "../services/styles/style.server";
import { getStyleReadiness } from "../services/styles/style-readiness.server";
import { authenticate } from "../shopify.server";
import {
  shopifyProductAdminUrl,
  shopifyStorefrontProductUrl,
  shopifyThemeEditorProductUrl,
} from "../utils/shopify-admin-link";

function stringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const styleId = params.styleId;

  if (!styleId) {
    throw new Response("Style ID is required", {
      status: 400,
    });
  }

  const style = await requireStyleForShop(session.shop, styleId);

  const url = new URL(request.url);

  // Nothing to push to Shopify unless the Style itself (product fields,
  // tags, collections, etc.) or one of its assets (media selection) has
  // changed since the last successful publish/update. Product option
  // changes (add/edit/delete/reorder, on either an option or a choice —
  // including a reorder alone, since Shopify's variant option values
  // follow this same position order) touch Style.updatedAt directly
  // (see touchStyle in style-options.server.ts), so they're already
  // covered by the updatedAt check below without needing their own
  // separate comparison here.
  const latestAssetChange = style.assets.reduce(
    (latest, asset) => Math.max(latest, asset.updatedAt.getTime()),
    0,
  );

  const hasPendingChanges =
    !style.publishedAt ||
    style.updatedAt.getTime() > style.publishedAt.getTime() ||
    latestAssetChange > style.publishedAt.getTime();

  return {
    styleId,

    status: style.status,

    publishError: style.publishError,

    productAdminUrl: style.shopifyProductId
      ? shopifyProductAdminUrl(session.shop, style.shopifyProductId)
      : null,

    storefrontUrl: style.shopifyProductHandle
      ? shopifyStorefrontProductUrl(session.shop, style.shopifyProductHandle)
      : null,

    themeEditorUrl: style.shopifyProductHandle
      ? shopifyThemeEditorProductUrl(session.shop, style.shopifyProductHandle)
      : null,

    readiness: getStyleReadiness(style),

    tagsCount: stringArray(style.tags).length,

    collectionsCount: stringArray(style.collectionIds).length,

    hasPendingChanges,

    // Fires whenever the set of active VARIANT-role options on the
    // Product options tab right now differs from what the last publish
    // actually created in Shopify — adding, removing, or combining
    // axes always replaces every variant (the option set itself
    // changes), which can break an already-open cart/checkout
    // referencing an old variant id. compositeKey joins
    // `${optionId}:${choiceId}` per active axis, so the set of optionIds
    // embedded in any one stored variant's key tells us which axes were
    // active last time.
    needsSizeVariantMigration: (() => {
      if (style.status !== "PUBLISHED") {
        return false;
      }

      const currentAxisOptionIds = new Set(
        style.options
          .filter((option) => option.role === "VARIANT" && option.choices.length > 0)
          .map((option) => option.id),
      );

      const storedVariants = parseSizeVariants(style.productSettings);

      const firstKey = storedVariants[0]?.compositeKey ?? "none";

      const storedAxisOptionIds = new Set(
        firstKey === "none"
          ? []
          : firstKey.split("::").map((part) => part.split(":")[0]),
      );

      if (currentAxisOptionIds.size !== storedAxisOptionIds.size) {
        return true;
      }

      for (const id of currentAxisOptionIds) {
        if (!storedAxisOptionIds.has(id)) {
          return true;
        }
      }

      return false;
    })(),

    published: url.searchParams.get("published") === "1",

    unpublished: url.searchParams.get("unpublished") === "1",
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin, redirect } = await authenticate.admin(request);

  const styleId = params.styleId;

  if (!styleId) {
    throw new Response("Style ID is required", {
      status: 400,
    });
  }

  const formData = await request.formData();

  const intent = formData.get("intent");

  if (intent === "unpublish") {
    try {
      await unpublishStyleFromShopify(admin, session.shop, styleId);

      return redirect(`/app/styles/${styleId}/publish?unpublished=1`);
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Could not unpublish this prompt.",
      };
    }
  }

  try {
    await publishStyleToShopify(admin, session.shop, styleId, request.url);

    return redirect(`/app/styles/${styleId}/publish?published=1`);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not publish this prompt.",
    };
  }
};

export default function StylePublish() {
  const {
    styleId,
    status,
    publishError,
    productAdminUrl,
    storefrontUrl,
    themeEditorUrl,
    readiness,
    tagsCount,
    collectionsCount,
    hasPendingChanges,
    needsSizeVariantMigration,
    published,
    unpublished,
  } = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();

  const navigation = useNavigation();

  const shopify = useAppBridge();

  const activeIntent = navigation.formData?.get("intent");

  const publishing = navigation.state !== "idle" && activeIntent === "publish";

  const unpublishing =
    navigation.state !== "idle" && activeIntent === "unpublish";

  useEffect(() => {
    if (!published && !unpublished) {
      return;
    }

    shopify.toast.show(unpublished ? "Prompt unpublished" : "Prompt published");

    // A successful unpublish leaves its triggering modal open, showing
    // stale content behind the toast — s-modal exposes hideOverlay()
    // directly on the element.
    document
      .querySelectorAll<HTMLElement & { hideOverlay?: () => void }>("s-modal")
      .forEach((modal) => modal.hideOverlay?.());

    // A plain URL cleanup, not a real navigation — history.replaceState
    // avoids a spurious loader revalidation that would otherwise flash
    // the Publish/Unpublish button into a loading state.
    window.history.replaceState(null, "", `/app/styles/${styleId}/publish`);
  }, [published, shopify, styleId, unpublished]);

  const readyCount = readiness.filter((item) => item.complete).length;

  const totalCount = readiness.length;

  const isReady = readyCount === totalCount;

  // An already-published product keeps its existing Shopify media when
  // no example photo is currently selected locally, so updating one
  // (title, description, price, etc.) shouldn't be blocked on
  // re-selecting an example photo the way the first-time publish is.
  const isUpdateReady = readiness
    .filter((item) => item.key !== "media")
    .every((item) => item.complete);

  const publishable = status === "PUBLISHED" ? isUpdateReady : isReady;

  return (
    <s-stack direction="block" gap="base">
      {actionData?.error ? (
        <s-banner tone="critical" heading="Action failed">
          <s-paragraph>{actionData.error}</s-paragraph>
        </s-banner>
      ) : publishError ? (
        <s-banner tone="critical" heading="The last attempt failed">
          <s-paragraph>{publishError}</s-paragraph>
        </s-banner>
      ) : null}

      {!publishable ? (
        <s-banner
          tone="warning"
          heading={
            status === "PUBLISHED"
              ? "Not ready to update yet"
              : "Not ready to publish yet"
          }
        >
          <s-paragraph>
            Finish the remaining items in the Readiness checklist below before{" "}
            {status === "PUBLISHED" ? "updating" : "publishing"}.
          </s-paragraph>
        </s-banner>
      ) : null}

      {status === "PUBLISHED" ? (
        <s-section heading="Manage product">
          <s-stack direction="block" gap="base">
            <s-text color="subdued">
              This prompt is live. Changed the images, product details, or
              customer fields since publishing? Update the product to push those
              changes to Shopify — no need to unpublish first.
            </s-text>

            {isUpdateReady && !hasPendingChanges ? (
              <s-text color="subdued">No changes to push yet.</s-text>
            ) : null}

            {needsSizeVariantMigration ? (
              <s-banner tone="warning" heading="Variants will change">
                <s-paragraph>
                  Sizes and/or framing configured on the Product tab don&rsquo;t
                  match this product&rsquo;s live variants yet. The next update
                  replaces them to match — any checkout already open with an
                  old variant will need to start over.
                </s-paragraph>
              </s-banner>
            ) : null}

            <Form method="post">
              <input type="hidden" name="intent" value="publish" />

              <s-stack direction="inline" gap="base">
                <s-button
                  type="submit"
                  variant="primary"
                  disabled={!isUpdateReady || !hasPendingChanges || publishing}
                  loading={publishing}
                  accessibilityLabel={
                    !isUpdateReady
                      ? "Complete the checklist before updating"
                      : !hasPendingChanges
                        ? "No changes to push yet"
                        : "Update product"
                  }
                >
                  Update product
                </s-button>

                <s-button
                  variant="secondary"
                  commandFor="unpublish-style"
                  command="--show"
                  disabled={publishing}
                >
                  Unpublish
                </s-button>
              </s-stack>
            </Form>
          </s-stack>

          <s-modal id="unpublish-style" heading="Unpublish this prompt?">
            <Form method="post">
              <input type="hidden" name="intent" value="unpublish" />

              <s-stack direction="block" gap="base">
                <s-paragraph>
                  The Shopify product will no longer be visible on the Online
                  Store. It is not deleted, and you can republish it at any
                  time.
                </s-paragraph>

                <s-stack direction="inline" gap="base">
                  <s-button
                    variant="secondary"
                    commandFor="unpublish-style"
                    command="--hide"
                  >
                    Cancel
                  </s-button>

                  <s-button
                    type="submit"
                    variant="primary"
                    disabled={unpublishing}
                    loading={unpublishing}
                  >
                    Unpublish
                  </s-button>
                </s-stack>
              </s-stack>
            </Form>
          </s-modal>
        </s-section>
      ) : (
        <s-section heading="Publish">
          <Form method="post">
            <input type="hidden" name="intent" value="publish" />

            <s-stack direction="block" gap="base">
              <s-button
                type="submit"
                variant="primary"
                disabled={!isReady || publishing}
                loading={publishing}
                accessibilityLabel={
                  isReady
                    ? "Publish product"
                    : "Complete the checklist before publishing"
                }
              >
                Publish product
              </s-button>
            </s-stack>
          </Form>
        </s-section>
      )}

      <s-section heading="Product organization">
        <s-stack direction="block" gap="base">
          <s-stack
            direction="inline"
            gap="small"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-text type="strong">Tags</s-text>

            <s-badge tone="neutral">{tagsCount}</s-badge>
          </s-stack>

          <s-stack
            direction="inline"
            gap="small"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-text type="strong">Collections</s-text>

            <s-badge tone="neutral">{collectionsCount}</s-badge>
          </s-stack>
        </s-stack>
      </s-section>

      {status === "PUBLISHED" && productAdminUrl ? (
        <s-section heading="View & customize">
          <s-stack direction="inline" gap="small-300">
            <s-button href={productAdminUrl} target="_blank">
              View product in Shopify
            </s-button>

            {storefrontUrl ? (
              <s-button href={storefrontUrl} target="_blank">
                View product on storefront
              </s-button>
            ) : null}

            {themeEditorUrl ? (
              <s-button href={themeEditorUrl} target="_blank">
                Customize product
              </s-button>
            ) : null}
          </s-stack>
        </s-section>
      ) : null}
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
