import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  Form,
  Outlet,
  useLoaderData,
  useLocation,
  useNavigation,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { StyleDesignPanel } from "../components/styles/style-design-panel";
import { StyleStatusBadge } from "../components/styles/style-status-badge";
import {
  requireStyleForShop,
  styleCanBeDeleted,
  styleCanBeEdited,
} from "../services/styles/style.server";
import { getStyleReadiness } from "../services/styles/style-readiness.server";
import { authenticate } from "../shopify.server";

const readinessSectionHrefs: Record<string, string> = {
  overview: "",
  fields: "/fields",
  product: "/product",
  media: "/media",
};

// `/app/styles/:styleId` matches both this pathless layout and its index
// child. The delete-style Form below (rendered here, on every tab) posts
// to that shared URL, and depending on which nested tab is active,
// React Router can resolve the submission to either route — so both
// need a working action. Reusing the index route's action (rather than
// duplicating the delete/duplicate handling here) keeps a single source
// of truth for both.
export { action } from "./app.styles.$styleId._index";

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

  return {
    style: {
      id: style.id,
      name: style.name,
      status: style.status,

      canDelete: styleCanBeDeleted(style),
      editable: styleCanBeEdited(style),

      fieldsCount: style.fields.length,

      imagesCount: style.assets.length,

      tagsCount: stringArray(style.tags).length,

      collectionsCount: stringArray(style.collectionIds).length,

      swatchWidthPx: style.swatchWidthPx,
      swatchHeightPx: style.swatchHeightPx,
      swatchFontSizePx: style.swatchFontSizePx,
      swatchWidthMobilePx: style.swatchWidthMobilePx,
      swatchHeightMobilePx: style.swatchHeightMobilePx,
      swatchFontSizeMobilePx: style.swatchFontSizeMobilePx,
    },

    readiness: getStyleReadiness(style),
  };
};

export default function StyleWorkspace() {
  const { style, readiness } = useLoaderData<typeof loader>();

  const location = useLocation();

  const navigation = useNavigation();

  const base = `/app/styles/${style.id}`;

  const deleting =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "deleteStyle";

  const pathname = location.pathname;

  const active =
    pathname === base || pathname === `${base}/`
      ? "overview"
      : pathname.startsWith(`${base}/options`)
        ? "options"
        : pathname.startsWith(`${base}/product`)
          ? "product"
          : pathname.startsWith(`${base}/generation`)
          ? "generation"
          : pathname.startsWith(`${base}/fields`)
            ? "fields"
            : pathname.startsWith(`${base}/media`)
              ? "media"
              : pathname.startsWith(`${base}/publish`)
                ? "publish"
                : "overview";

  const navVariant = (section: string) =>
    active === section ? "secondary" : "tertiary";

  return (
    <s-page heading={style.name}>
      <s-link slot="breadcrumb-actions" href="/app/styles">
        Prompts
      </s-link>

      <s-button
        slot="secondary-actions"
        variant="tertiary"
        icon="export"
        href={`${base}/export`}
        target="_blank"
      >
        Export
      </s-button>

      <s-stack direction="block" gap="base">
        <s-box
          padding="small-200"
          background="base"
          borderWidth="base"
          borderColor="base"
          borderRadius="base"
        >
          <s-stack
            direction="inline"
            gap="base"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-stack
              direction="inline"
              gap="small-200"
              alignItems="center"
              accessibilityLabel="Prompt workspace sections"
            >
              <s-button href={base} variant={navVariant("overview")}>
                Prompt
              </s-button>

              <s-button
                href={`${base}/product`}
                variant={navVariant("product")}
              >
                Product
              </s-button>

              <s-button
                href={`${base}/options`}
                variant={navVariant("options")}
              >
                Product options
              </s-button>

              <s-button href={`${base}/media`} variant={navVariant("media")}>
                Media
              </s-button>

              <s-button
                href={`${base}/generation`}
                variant={navVariant("generation")}
              >
                Generation
              </s-button>

              <s-button href={`${base}/fields`} variant={navVariant("fields")}>
                Customer inputs
              </s-button>

              <s-button
                href={`${base}/publish`}
                variant={navVariant("publish")}
              >
                Publish
              </s-button>
            </s-stack>

            <s-stack direction="inline" gap="base" alignItems="center">
              <StyleStatusBadge status={style.status} />

              {style.canDelete ? (
                <s-button
                  variant="tertiary"
                  tone="critical"
                  icon="delete"
                  commandFor="delete-style"
                  command="--show"
                >
                  Delete prompt
                </s-button>
              ) : null}
            </s-stack>
          </s-stack>
        </s-box>

        <s-grid gridTemplateColumns="2fr minmax(280px, 1fr)" gap="base">
          <Outlet />

          <div
            style={{
              position: "sticky",
              top: 16,
              alignSelf: "start",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <s-section heading="What's left to finish">
              <s-stack direction="block" gap="base">
                {readiness.map((item) => (
                  <div
                    key={item.key}
                    style={{
                      display: "flex",
                      flexWrap: "nowrap",
                      alignItems: "flex-start",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        flex: "0 0 20px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 20,
                        height: 20,
                        maxWidth: 20,
                        maxHeight: 20,
                        overflow: "hidden",
                        marginTop: 2,
                      }}
                    >
                      <s-icon
                        type={
                          item.complete ? "check-circle-filled" : "alert-circle"
                        }
                        tone={item.complete ? "success" : "warning"}
                        size="small"
                      />
                    </div>

                    <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                      <s-stack direction="block" gap="small-200">
                        <s-text type="strong">{item.label}</s-text>

                        <s-text color="subdued">{item.description}</s-text>

                        {!item.complete &&
                        readinessSectionHrefs[item.section] ? (
                          <s-link
                            href={`${base}${readinessSectionHrefs[item.section]}`}
                          >
                            Set up
                          </s-link>
                        ) : null}
                      </s-stack>
                    </div>
                  </div>
                ))}
              </s-stack>
            </s-section>

            {active === "options" ? (
              <StyleDesignPanel
                styleId={style.id}
                editable={style.editable}
                values={{
                  swatchWidthPx: style.swatchWidthPx,
                  swatchHeightPx: style.swatchHeightPx,
                  swatchFontSizePx: style.swatchFontSizePx,
                  swatchWidthMobilePx: style.swatchWidthMobilePx,
                  swatchHeightMobilePx: style.swatchHeightMobilePx,
                  swatchFontSizeMobilePx: style.swatchFontSizeMobilePx,
                }}
              />
            ) : null}
          </div>
        </s-grid>
      </s-stack>

      {style.canDelete ? (
        <s-modal id="delete-style" heading="Delete this prompt?">
          <Form method="post" action={base}>
            <input type="hidden" name="intent" value="deleteStyle" />

            <s-stack direction="block" gap="base">
              <s-paragraph>
                Delete “{style.name}” permanently, including its customer
                fields, generated images, and generation history?
                {style.status === "PUBLISHED"
                  ? " This will also delete its live Shopify product."
                  : ""}
              </s-paragraph>

              <s-text tone="critical">This action cannot be undone.</s-text>

              <s-stack direction="inline" gap="base">
                <s-button
                  variant="secondary"
                  commandFor="delete-style"
                  command="--hide"
                  disabled={deleting}
                >
                  Cancel
                </s-button>

                <s-button
                  type="submit"
                  variant="primary"
                  tone="critical"
                  loading={deleting}
                  disabled={deleting}
                >
                  Delete prompt
                </s-button>
              </s-stack>
            </s-stack>
          </Form>
        </s-modal>
      ) : null}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
