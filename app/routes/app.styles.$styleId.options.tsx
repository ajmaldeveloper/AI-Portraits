import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { AXIS_ROLE_NONE, StyleOptionsEditor } from "../components/styles/style-options-editor";
import { createSignedStyleAssetUrl } from "../services/media/media-signing.server";
import { uploadStyleFrameTexture } from "../services/styles/style-product-media.server";
import { syncStylePricingToShopify } from "../services/styles/style-pricing-sync.server";
import {
  createStyleOption,
  createStyleOptionChoice,
  deleteStyleOption,
  deleteStyleOptionChoice,
  reorderStyleOptionChoices,
  reorderStyleOptions,
  type StyleOptionChoiceInput,
  type StyleOptionInput,
  updateStyleOption,
  updateStyleOptionChoice,
} from "../services/styles/style-options.server";
import { requireStyleForShop, styleCanBeEdited } from "../services/styles/style.server";
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

// Best-effort — the option/choice change is already committed to the
// DB by the time this runs, so a Shopify sync failure here must never
// block the save or roll anything back. It's logged and left for the
// next save (or a future manual retry) to pick up.
async function syncPricingBestEffort(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  shop: string,
) {
  const result = await syncStylePricingToShopify(admin, shop);

  if (!result.ok) {
    console.error(`Could not sync Shopify pricing for shop ${shop}: ${result.message}`);
  }
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const styleId = params.styleId;

  if (!styleId) {
    throw new Response("Style ID is required", { status: 400 });
  }

  const style = await requireStyleForShop(session.shop, styleId);

  const url = new URL(request.url);

  const editable = styleCanBeEdited(style);

  return {
    styleId,

    notice: url.searchParams.get("notice"),

    editable,

    options: style.options.map((option) => ({
      id: option.id,
      label: option.label,
      type: option.type,
      axisRole: option.axisRole,
      imageOrientation: option.imageOrientation,
      imageFit: option.imageFit,
      swatchWidthPx: option.swatchWidthPx,
      swatchHeightPx: option.swatchHeightPx,
      swatchFontSizePx: option.swatchFontSizePx,
      swatchWidthMobilePx: option.swatchWidthMobilePx,
      swatchHeightMobilePx: option.swatchHeightMobilePx,
      swatchFontSizeMobilePx: option.swatchFontSizeMobilePx,
      choices: option.choices.map((choice) => ({
        id: choice.id,
        label: choice.label,
        priceDelta: choice.priceDelta?.toString() ?? "",
        compareAtPriceDelta: choice.compareAtPriceDelta?.toString() ?? "",
        requiresShipping: choice.requiresShipping,
        scalePercent: choice.scalePercent,
        hexColor: choice.hexColor ?? "",
        imageAssetId: choice.imageAssetId,
        imageUrl: choice.imageAssetId
          ? createSignedStyleAssetUrl(request.url, choice.imageAssetId, session.shop)
          : null,
        borderThicknessPx: choice.borderThicknessPx,
        matThicknessPx: choice.matThicknessPx,
        borderRadiusPx: choice.borderRadiusPx,
      })),
    })),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin, redirect } = await authenticate.admin(request);

  const styleId = params.styleId;

  if (!styleId) {
    throw new Response("Style ID is required", { status: 400 });
  }

  const formData = await request.formData();

  const intent = formValue(formData, "intent");

  try {
    if (intent === "addOption" || intent === "editOption") {
      const rawAxisRole = formValue(formData, "axisRole");

      const input: StyleOptionInput = {
        label: formValue(formData, "label"),
        type: formValue(formData, "type"),
        axisRole: rawAxisRole && rawAxisRole !== AXIS_ROLE_NONE ? rawAxisRole : null,
        imageOrientation: formValue(formData, "imageOrientation"),
        imageFit: formValue(formData, "imageFit"),
        swatchWidthPx: numberValue(formData, "swatchWidthPx"),
        swatchHeightPx: numberValue(formData, "swatchHeightPx"),
        swatchFontSizePx: numberValue(formData, "swatchFontSizePx"),
        swatchWidthMobilePx: numberValue(formData, "swatchWidthMobilePx"),
        swatchHeightMobilePx: numberValue(formData, "swatchHeightMobilePx"),
        swatchFontSizeMobilePx: numberValue(formData, "swatchFontSizeMobilePx"),
      };

      if (intent === "addOption") {
        await createStyleOption(session.shop, styleId, input);
      } else {
        const optionId = formValue(formData, "optionId");

        await updateStyleOption(session.shop, styleId, optionId, input);
      }

      await syncPricingBestEffort(admin, session.shop);

      return redirect(`/app/styles/${styleId}/options?notice=option-saved`);
    }

    if (intent === "deleteOption") {
      const optionId = formValue(formData, "optionId");

      await deleteStyleOption(session.shop, styleId, optionId);

      await syncPricingBestEffort(admin, session.shop);

      return redirect(`/app/styles/${styleId}/options?notice=option-deleted`);
    }

    if (intent === "reorderOptions") {
      const orderedOptionIds = formData
        .getAll("optionId")
        .filter((value): value is string => typeof value === "string" && value.length > 0);

      if (orderedOptionIds.length === 0) {
        throw new Error("Option order is required.");
      }

      await reorderStyleOptions(session.shop, styleId, orderedOptionIds);

      return redirect(`/app/styles/${styleId}/options?notice=options-reordered`);
    }

    if (intent === "addChoice" || intent === "editChoice") {
      const optionId = formValue(formData, "optionId");

      // A fresh upload takes precedence over a previously-uploaded
      // asset id carried in a hidden field (editing a choice without
      // picking a new file keeps the existing image) — this is the
      // one field that needs a real side effect (a DB write) before
      // the choice itself can be validated/saved, so it happens first
      // and in the same request rather than as a separate round trip.
      const uploadedFile = formData.get("imageFile");

      let imageAssetId = formValue(formData, "existingImageAssetId") || null;

      if (uploadedFile instanceof File && uploadedFile.size > 0) {
        const bytes = new Uint8Array(await uploadedFile.arrayBuffer());

        const asset = await uploadStyleFrameTexture(session.shop, styleId, {
          bytes,
          mimeType: uploadedFile.type || "application/octet-stream",
        });

        imageAssetId = asset.id;
      }

      const input: StyleOptionChoiceInput = {
        label: formValue(formData, "label"),
        priceDelta: formValue(formData, "priceDelta") || null,
        compareAtPriceDelta: formValue(formData, "compareAtPriceDelta") || null,
        requiresShipping: formData.has("requiresShipping"),
        scalePercent: numberValue(formData, "scalePercent"),
        hexColor: formValue(formData, "hexColor") || null,
        imageAssetId,
        borderThicknessPx: numberValue(formData, "borderThicknessPx"),
        matThicknessPx: numberValue(formData, "matThicknessPx"),
        borderRadiusPx: numberValue(formData, "borderRadiusPx"),
      };

      if (intent === "addChoice") {
        await createStyleOptionChoice(session.shop, styleId, optionId, input);
      } else {
        const choiceId = formValue(formData, "choiceId");

        await updateStyleOptionChoice(session.shop, styleId, optionId, choiceId, input);
      }

      await syncPricingBestEffort(admin, session.shop);

      return redirect(`/app/styles/${styleId}/options?notice=choice-saved`);
    }

    if (intent === "deleteChoice") {
      const optionId = formValue(formData, "optionId");

      const choiceId = formValue(formData, "choiceId");

      await deleteStyleOptionChoice(session.shop, styleId, optionId, choiceId);

      await syncPricingBestEffort(admin, session.shop);

      return redirect(`/app/styles/${styleId}/options?notice=choice-deleted`);
    }

    if (intent === "reorderChoices") {
      const optionId = formValue(formData, "optionId");

      const orderedChoiceIds = formData
        .getAll("choiceId")
        .filter((value): value is string => typeof value === "string" && value.length > 0);

      if (orderedChoiceIds.length === 0) {
        throw new Error("Choice order is required.");
      }

      await reorderStyleOptionChoices(session.shop, styleId, optionId, orderedChoiceIds);

      return redirect(`/app/styles/${styleId}/options?notice=choices-reordered`);
    }

    throw new Error("Unknown action.");
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not update product options.",
    };
  }
};

const notices: Record<string, string> = {
  "option-saved": "Option saved",
  "option-deleted": "Option deleted",
  "options-reordered": "Options reordered",
  "choice-saved": "Choice saved",
  "choice-deleted": "Choice deleted",
  "choices-reordered": "Choices reordered",
};

export default function StyleOptions() {
  const data = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();

  const shopify = useAppBridge();

  const backNav = useNavigatingTo();

  const nextNav = useNavigatingTo();

  useEffect(() => {
    if (!data.notice) {
      return;
    }

    const message = notices[data.notice];

    if (!message) {
      return;
    }

    // A successful add/edit/delete leaves its triggering modal open,
    // showing stale content behind the toast. s-modal exposes
    // hideOverlay() directly on the element, but on this tab (many
    // s-modal instances at once — every option/choice row has its own
    // Edit and Delete modal) it isn't reliably closing them. Simulating
    // a click on each modal's own Cancel button reuses the exact
    // interaction that's known to work (a human clicking Cancel), via
    // a temporary invoker button rather than assuming a Cancel button
    // exists inside every modal.
    const closeOpenModals = () => {
      document.querySelectorAll<HTMLElement>("s-modal").forEach((modal) => {
        (modal as HTMLElement & { hideOverlay?: () => void }).hideOverlay?.();

        const id = modal.id;

        if (!id) {
          return;
        }

        const invoker = document.createElement("s-button") as HTMLElement & {
          commandFor?: string;
          command?: string;
        };

        invoker.style.display = "none";

        document.body.appendChild(invoker);

        invoker.commandFor = id;
        invoker.command = "--hide";
        invoker.setAttribute("commandfor", id);
        invoker.setAttribute("command", "--hide");

        invoker.click();
        invoker.remove();
      });
    };

    closeOpenModals();
    requestAnimationFrame(closeOpenModals);

    shopify.toast.show(message);

    window.history.replaceState(null, "", `/app/styles/${data.styleId}/options`);
  }, [data.notice, data.styleId, shopify]);

  return (
    <s-stack direction="block" gap="base">
      {actionData?.error ? (
        <s-banner tone="critical" heading="Could not save product options">
          <s-paragraph>{actionData.error}</s-paragraph>
        </s-banner>
      ) : null}

      <StyleOptionsEditor options={data.options} editable={data.editable} />

      <s-stack direction="inline" gap="base">
        <s-button
          href={`/app/styles/${data.styleId}/product`}
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
