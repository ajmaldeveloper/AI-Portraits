import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { StyleDesignPanel } from "../components/styles/style-design-panel";
import {
  requireStyleForShop,
  styleCanBeEdited,
  updateStyleDraft,
} from "../services/styles/style.server";
import { authenticate } from "../shopify.server";
import { useNavigatingTo } from "../utils/use-navigating-to";

function formValue(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function numberValue(formData: FormData, key: string) {
  const value = formValue(formData, key);

  return value ? Number(value) : null;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const styleId = params.styleId;

  if (!styleId) {
    throw new Response("Style ID is required", { status: 400 });
  }

  const style = await requireStyleForShop(session.shop, styleId);

  const url = new URL(request.url);

  return {
    styleId,

    notice: url.searchParams.get("notice"),

    editable: styleCanBeEdited(style),

    values: {
      swatchWidthPx: style.swatchWidthPx,
      swatchHeightPx: style.swatchHeightPx,
      swatchFontSizePx: style.swatchFontSizePx,
      swatchWidthMobilePx: style.swatchWidthMobilePx,
      swatchHeightMobilePx: style.swatchHeightMobilePx,
      swatchFontSizeMobilePx: style.swatchFontSizeMobilePx,
      swatchGapPx: style.swatchGapPx,
      swatchBorderColor: style.swatchBorderColor,
      swatchActiveBorderColor: style.swatchActiveBorderColor,
      swatchRadiusPx: style.swatchRadiusPx,
      swatchBackgroundColor: style.swatchBackgroundColor,
      swatchActiveBackgroundColor: style.swatchActiveBackgroundColor,
      swatchFullBleed: style.swatchFullBleed,
    },
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);

  const styleId = params.styleId;

  if (!styleId) {
    throw new Response("Style ID is required", { status: 400 });
  }

  const formData = await request.formData();

  try {
    await updateStyleDraft(session.shop, styleId, {
      swatchWidthPx: numberValue(formData, "swatchWidthPx"),
      swatchHeightPx: numberValue(formData, "swatchHeightPx"),
      swatchFontSizePx: numberValue(formData, "swatchFontSizePx"),
      swatchWidthMobilePx: numberValue(formData, "swatchWidthMobilePx"),
      swatchHeightMobilePx: numberValue(formData, "swatchHeightMobilePx"),
      swatchFontSizeMobilePx: numberValue(formData, "swatchFontSizeMobilePx"),
      swatchGapPx: numberValue(formData, "swatchGapPx"),
      swatchBorderColor: formValue(formData, "swatchBorderColor") || null,
      swatchActiveBorderColor: formValue(formData, "swatchActiveBorderColor") || null,
      swatchRadiusPx: numberValue(formData, "swatchRadiusPx"),
      swatchBackgroundColor: formValue(formData, "swatchBackgroundColor") || null,
      swatchActiveBackgroundColor:
        formValue(formData, "swatchActiveBackgroundColor") || null,
      swatchFullBleed: formData.has("swatchFullBleed"),
    });

    return redirect(`/app/styles/${styleId}/design?notice=design-saved`);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not save the design.",
    };
  }
};

export default function StyleDesign() {
  const data = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();

  const shopify = useAppBridge();

  const backNav = useNavigatingTo();

  const nextNav = useNavigatingTo();

  useEffect(() => {
    if (data.notice !== "design-saved") {
      return;
    }

    shopify.toast.show("Design saved");

    window.history.replaceState(null, "", `/app/styles/${data.styleId}/design`);
  }, [data.notice, data.styleId, shopify]);

  return (
    <s-stack direction="block" gap="base">
      {actionData?.error ? (
        <s-banner tone="critical" heading="Could not save the design">
          <s-paragraph>{actionData.error}</s-paragraph>
        </s-banner>
      ) : null}

      <StyleDesignPanel
        styleId={data.styleId}
        editable={data.editable}
        values={data.values}
      />

      <s-stack direction="inline" gap="base">
        <s-button
          href={`/app/styles/${data.styleId}/options`}
          loading={backNav.loading}
          onClick={backNav.onClick}
        >
          Back
        </s-button>

        <s-button
          href={`/app/styles/${data.styleId}/media`}
          variant="primary"
          loading={nextNav.loading}
          onClick={nextNav.onClick}
        >
          Next
        </s-button>
      </s-stack>
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
