import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { StyleOverviewForm } from "../components/styles/style-overview-form";
import { deleteStyleAndShopifyProduct } from "../services/styles/style-publish.server";
import {
  duplicateStyleDraft,
  requireStyleForShop,
  styleCanBeEdited,
  updateStyleDraft,
} from "../services/styles/style.server";
import { authenticate } from "../shopify.server";

function value(formData: FormData, key: string) {
  const entry = formData.get(key);

  return typeof entry === "string" ? entry.trim() : "";
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

  const editable = styleCanBeEdited(style);

  return {
    created: url.searchParams.get("created") === "1",

    duplicated: url.searchParams.get("duplicated") === "1",

    imported: url.searchParams.get("imported") === "1",

    editable,

    style: {
      id: style.id,

      values: {
        name: style.name,

        prompt: style.prompt,
      },
    },
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

  const intent = value(formData, "intent");

  if (intent === "deleteStyle") {
    try {
      await deleteStyleAndShopifyProduct(admin, session.shop, styleId);

      return redirect(`/app/styles?deleted=1`);
    } catch (error) {
      return {
        error:
          error instanceof Error ? error.message : "Could not delete prompt.",
      };
    }
  }

  if (intent === "duplicateStyle") {
    try {
      const duplicate = await duplicateStyleDraft(session.shop, styleId);

      return redirect(`/app/styles/${duplicate.id}?duplicated=1`);
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Could not duplicate prompt.",
      };
    }
  }

  const name = value(formData, "name");

  const prompt = value(formData, "prompt");

  if (!name) {
    return {
      error: "Internal name is required.",
    };
  }

  try {
    await updateStyleDraft(session.shop, styleId, {
      name,
      prompt,
    });

    return redirect(`/app/styles/${styleId}/product`);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not save prompt.",
    };
  }
};

export default function StyleOverview() {
  const { created, duplicated, imported, editable, style } =
    useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();

  const shopify = useAppBridge();

  useEffect(() => {
    if (!created && !duplicated && !imported) {
      return;
    }

    shopify.toast.show(
      imported
        ? "Prompt imported"
        : duplicated
          ? "Prompt duplicated"
          : "Prompt created",
    );

    // A plain URL cleanup, not a real navigation — history.replaceState
    // avoids a spurious loader revalidation that would otherwise flash
    // the Save button into a loading state right after landing here.
    window.history.replaceState(null, "", `/app/styles/${style.id}`);
  }, [created, duplicated, imported, shopify, style.id]);

  return (
    <StyleOverviewForm
      values={style.values}
      editable={editable}
      styleId={style.id}
      error={actionData?.error}
    />
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
