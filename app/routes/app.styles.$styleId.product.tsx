import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { ProductConfiguration } from "../components/styles/product-configuration";
import {
  createStyleFramingOption,
  deleteStyleFramingOption,
  reorderStyleFramingOptions,
  type StyleFramingOptionInput,
  updateStyleFramingOption,
} from "../services/styles/style-framing-options.server";
import {
  createStyleMatColor,
  deleteStyleMatColor,
  reorderStyleMatColors,
  type StyleMatColorInput,
  updateStyleMatColor,
} from "../services/styles/style-mat-colors.server";
import {
  createStyleSizeOption,
  deleteStyleSizeOption,
  reorderStyleSizeOptions,
  type StyleSizeOptionInput,
  updateStyleSizeOption,
} from "../services/styles/style-size-options.server";
import {
  requireStyleForShop,
  styleCanBeEdited,
  updateStyleDraft,
} from "../services/styles/style.server";
import { authenticate } from "../shopify.server";
import { useNavigatingTo } from "../utils/use-navigating-to";

function stringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function formValue(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function parseTags(entry: FormDataEntryValue | null) {
  if (typeof entry !== "string") {
    throw new Error("Invalid tags.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(entry);
  } catch {
    throw new Error("Invalid tags.");
  }

  if (!Array.isArray(parsed) || parsed.some((tag) => typeof tag !== "string")) {
    throw new Error("Invalid tags.");
  }

  const tags: string[] = [];
  const seen = new Set<string>();

  for (const raw of parsed as string[]) {
    const tag = raw.trim();

    if (!tag) {
      continue;
    }

    const key = tag.toLocaleLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    tags.push(tag);
  }

  return tags;
}

function parseCollectionIds(entry: FormDataEntryValue | null) {
  if (typeof entry !== "string") {
    throw new Error("Invalid collection selection.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(entry);
  } catch {
    throw new Error("Invalid collection selection.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Invalid collection selection.");
  }

  const ids = parsed.filter((item): item is string => typeof item === "string");

  if (ids.length !== parsed.length) {
    throw new Error("Invalid collection selection.");
  }

  if (ids.some((id) => !id.startsWith("gid://shopify/Collection/"))) {
    throw new Error("Invalid Shopify collection ID.");
  }

  return Array.from(new Set(ids));
}

type CollectionNode = {
  id: string;
  title: string;
  handle: string;
};

async function resolveCollections(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  collectionIds: string[],
) {
  if (collectionIds.length === 0) {
    return [];
  }

  try {
    const response = await admin.graphql(
      `#graphql
          query StyleCollections(
            $ids: [ID!]!
          ) {
            nodes(ids: $ids) {
              ... on Collection {
                id
                title
                handle
              }
            }
          }
        `,
      {
        variables: {
          ids: collectionIds,
        },
      },
    );

    const payload = (await response.json()) as {
      data?: {
        nodes?: Array<CollectionNode | null>;
      };
    };

    const nodes = payload.data?.nodes ?? [];

    const map = new Map(
      nodes
        .filter((node): node is CollectionNode =>
          Boolean(node?.id && node.title),
        )
        .map((node) => [node.id, node]),
    );

    return collectionIds.map((id) => {
      const node = map.get(id);

      return (
        node ?? {
          id,
          title: `Collection ${id.split("/").pop() ?? ""}`,
          handle: "",
        }
      );
    });
  } catch {
    return collectionIds.map((id) => ({
      id,
      title: `Collection ${id.split("/").pop() ?? ""}`,
      handle: "",
    }));
  }
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  const styleId = params.styleId;

  if (!styleId) {
    throw new Response("Style ID is required", {
      status: 400,
    });
  }

  const style = await requireStyleForShop(session.shop, styleId);

  const url = new URL(request.url);

  const collectionIds = stringArray(style.collectionIds);

  const editable = styleCanBeEdited(style);

  return {
    styleId,

    notice: url.searchParams.get("notice"),

    editable,

    productTitle: style.productTitle,

    productDescription: style.productDescription,

    basePrice: style.basePrice.toString(),

    compareAtPrice: style.compareAtPrice?.toString() ?? "",

    tags: stringArray(style.tags),

    collections: await resolveCollections(admin, collectionIds),

    sizeOptions: style.sizeOptions.map((option) => ({
      id: option.id,
      label: option.label,
      scalePercent: option.scalePercent,
      price: option.price.toString(),
      compareAtPrice: option.compareAtPrice?.toString() ?? "",
    })),

    framingOptions: style.framingOptions.map((option) => ({
      id: option.id,
      label: option.label,
      priceDelta: option.priceDelta.toString(),
      compareAtPriceDelta: option.compareAtPriceDelta?.toString() ?? "",
      requiresShipping: option.requiresShipping,
      frameColor: option.frameColor ?? "",
    })),

    matColors: style.matColors.map((color) => ({
      id: color.id,
      label: color.label,
      hexColor: color.hexColor,
    })),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);

  const styleId = params.styleId;

  if (!styleId) {
    throw new Response("Style ID is required", {
      status: 400,
    });
  }

  const formData = await request.formData();

  const intent = formValue(formData, "intent") || "saveProduct";

  try {
    if (intent === "addSize" || intent === "editSize") {
      const input: StyleSizeOptionInput = {
        label: formValue(formData, "label"),
        scalePercent: Number(formValue(formData, "scalePercent")),
        price: formValue(formData, "price"),
        compareAtPrice: formValue(formData, "compareAtPrice") || null,
      };

      if (intent === "addSize") {
        await createStyleSizeOption(session.shop, styleId, input);
      } else {
        const sizeOptionId = formValue(formData, "sizeOptionId");

        await updateStyleSizeOption(session.shop, styleId, sizeOptionId, input);
      }

      return redirect(`/app/styles/${styleId}/product?notice=size-saved`);
    }

    if (intent === "deleteSize") {
      const sizeOptionId = formValue(formData, "sizeOptionId");

      await deleteStyleSizeOption(session.shop, styleId, sizeOptionId);

      return redirect(`/app/styles/${styleId}/product?notice=size-deleted`);
    }

    if (intent === "reorderSizes") {
      const orderedSizeOptionIds = formData
        .getAll("sizeOptionId")
        .filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0,
        );

      if (orderedSizeOptionIds.length === 0) {
        throw new Error("Size order is required.");
      }

      await reorderStyleSizeOptions(session.shop, styleId, orderedSizeOptionIds);

      return redirect(`/app/styles/${styleId}/product?notice=sizes-reordered`);
    }

    if (intent === "addFraming" || intent === "editFraming") {
      const input: StyleFramingOptionInput = {
        label: formValue(formData, "label"),
        priceDelta: formValue(formData, "priceDelta"),
        compareAtPriceDelta: formValue(formData, "compareAtPriceDelta") || null,
        requiresShipping: formData.has("requiresShipping"),
        frameColor: formValue(formData, "frameColor") || null,
      };

      if (intent === "addFraming") {
        await createStyleFramingOption(session.shop, styleId, input);
      } else {
        const framingOptionId = formValue(formData, "framingOptionId");

        await updateStyleFramingOption(
          session.shop,
          styleId,
          framingOptionId,
          input,
        );
      }

      return redirect(`/app/styles/${styleId}/product?notice=framing-saved`);
    }

    if (intent === "deleteFraming") {
      const framingOptionId = formValue(formData, "framingOptionId");

      await deleteStyleFramingOption(session.shop, styleId, framingOptionId);

      return redirect(`/app/styles/${styleId}/product?notice=framing-deleted`);
    }

    if (intent === "reorderFraming") {
      const orderedFramingOptionIds = formData
        .getAll("framingOptionId")
        .filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0,
        );

      if (orderedFramingOptionIds.length === 0) {
        throw new Error("Framing order is required.");
      }

      await reorderStyleFramingOptions(
        session.shop,
        styleId,
        orderedFramingOptionIds,
      );

      return redirect(
        `/app/styles/${styleId}/product?notice=framing-reordered`,
      );
    }

    if (intent === "addMatColor" || intent === "editMatColor") {
      const input: StyleMatColorInput = {
        label: formValue(formData, "label"),
        hexColor: formValue(formData, "hexColor"),
      };

      if (intent === "addMatColor") {
        await createStyleMatColor(session.shop, styleId, input);
      } else {
        const matColorId = formValue(formData, "matColorId");

        await updateStyleMatColor(session.shop, styleId, matColorId, input);
      }

      return redirect(`/app/styles/${styleId}/product?notice=mat-color-saved`);
    }

    if (intent === "deleteMatColor") {
      const matColorId = formValue(formData, "matColorId");

      await deleteStyleMatColor(session.shop, styleId, matColorId);

      return redirect(
        `/app/styles/${styleId}/product?notice=mat-color-deleted`,
      );
    }

    if (intent === "reorderMatColors") {
      const orderedMatColorIds = formData
        .getAll("matColorId")
        .filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0,
        );

      if (orderedMatColorIds.length === 0) {
        throw new Error("Mat color order is required.");
      }

      await reorderStyleMatColors(session.shop, styleId, orderedMatColorIds);

      return redirect(
        `/app/styles/${styleId}/product?notice=mat-colors-reordered`,
      );
    }

    const productTitle = formValue(formData, "productTitle");

    const productDescription = formValue(formData, "productDescription");

    const basePrice = formValue(formData, "basePrice");

    const compareAtPrice = formValue(formData, "compareAtPrice");

    if (!productTitle) {
      return {
        error: "Product title is required.",
      };
    }

    if (!/^\d+(?:\.\d{1,2})?$/.test(basePrice)) {
      return {
        error:
          "Base price must be a non-negative number with up to two decimal places.",
      };
    }

    if (compareAtPrice && !/^\d+(?:\.\d{1,2})?$/.test(compareAtPrice)) {
      return {
        error:
          "Compare-at price must be a non-negative number with up to two decimal places.",
      };
    }

    const tags = parseTags(formData.get("tags"));

    const collectionIds = parseCollectionIds(formData.get("collectionIds"));

    await updateStyleDraft(session.shop, styleId, {
      productTitle,
      productDescription,
      basePrice,
      compareAtPrice: compareAtPrice || null,
      tags,
      collectionIds,
    });

    return redirect(`/app/styles/${styleId}/product?notice=product-saved`);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not update product configuration.",
    };
  }
};

const notices: Record<string, string> = {
  "product-saved": "Product details saved",
  "size-saved": "Size saved",
  "size-deleted": "Size deleted",
  "sizes-reordered": "Sizes reordered",
  "framing-saved": "Framing option saved",
  "framing-deleted": "Framing option deleted",
  "framing-reordered": "Framing options reordered",
  "mat-color-saved": "Mat color saved",
  "mat-color-deleted": "Mat color deleted",
  "mat-colors-reordered": "Mat colors reordered",
};

export default function StyleProduct() {
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
    // s-modal instances at once — every Size/Framing row has its own
    // Edit and Delete modal) it isn't reliably closing them. Simulating
    // a click on each modal's own Cancel
    // button reuses the exact interaction that's known to work (a
    // human clicking Cancel), via a temporary invoker button rather
    // than assuming a Cancel button exists inside every modal.
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

        // Property AND attribute, since it's unclear which one this
        // custom element's commandFor/command binding actually reads —
        // matches how the working, hand-authored Cancel buttons behave
        // (set as JSX props, which Preact may apply as either).
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

    // A plain URL cleanup, not a real navigation — history.replaceState
    // avoids a spurious loader revalidation that would otherwise flash
    // the Save button into a loading state right after landing here.
    window.history.replaceState(
      null,
      "",
      `/app/styles/${data.styleId}/product`,
    );
  }, [data.notice, data.styleId, shopify]);

  return (
    <s-stack direction="block" gap="base">
      {actionData?.error ? (
        <s-banner tone="critical" heading="Could not save product settings">
          <s-paragraph>{actionData.error}</s-paragraph>
        </s-banner>
      ) : null}

      <ProductConfiguration
        productTitle={data.productTitle}
        productDescription={data.productDescription}
        basePrice={data.basePrice}
        compareAtPrice={data.compareAtPrice}
        tags={data.tags}
        collections={data.collections}
        sizeOptions={data.sizeOptions}
        framingOptions={data.framingOptions}
        matColors={data.matColors}
        editable={data.editable}
      />

      <s-stack direction="inline" gap="base">
        <s-button
          href={`/app/styles/${data.styleId}`}
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

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
