import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

import { CustomerFields } from "../components/styles/customer-fields";
import {
  createStyleField,
  deleteStyleField,
  moveStyleField,
  reorderStyleFields,
  updateStyleField,
} from "../services/styles/style-fields.server";
import {
  requireStyleForShop,
  styleCanBeEdited,
} from "../services/styles/style.server";
import { authenticate } from "../shopify.server";
import { parseStyleFieldForm } from "../utils/style-fields-form.server";
import { useNavigatingTo } from "../utils/use-navigating-to";

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

  const editable = styleCanBeEdited(style);

  return {
    styleId,

    notice: url.searchParams.get("notice"),

    editable,

    fields: style.fields.map((field) => ({
      id: field.id,

      key: field.key,

      label: field.label,

      type: field.type,

      required: field.required,

      placeholder: field.placeholder,

      helpText: field.helpText,

      defaultValue: field.defaultValue,

      options: stringArray(field.options),
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

  const intentEntry = formData.get("intent");

  const intent = typeof intentEntry === "string" ? intentEntry : "";

  try {
    if (intent === "addField") {
      const parsed = parseStyleFieldForm(formData);

      if (!parsed.input) {
        return {
          error: parsed.error ?? "Check the field and try again.",
        };
      }

      await createStyleField(session.shop, styleId, parsed.input);

      return redirect(`/app/styles/${styleId}/fields?notice=field-added`);
    }

    if (intent === "editField") {
      const fieldId = formData.get("fieldId");

      if (typeof fieldId !== "string" || !fieldId) {
        throw new Error("Customer field ID is required.");
      }

      const parsed = parseStyleFieldForm(formData);

      if (!parsed.input) {
        return {
          error: parsed.error ?? "Check the field and try again.",
        };
      }

      await updateStyleField(session.shop, styleId, fieldId, parsed.input);

      return redirect(`/app/styles/${styleId}/fields?notice=field-updated`);
    }

    if (intent === "deleteField") {
      const fieldId = formData.get("fieldId");

      if (typeof fieldId !== "string" || !fieldId) {
        throw new Error("Customer field ID is required.");
      }

      await deleteStyleField(session.shop, styleId, fieldId);

      return redirect(`/app/styles/${styleId}/fields?notice=field-deleted`);
    }

    if (intent === "moveField") {
      const fieldId = formData.get("fieldId");

      const direction = formData.get("direction");

      if (typeof fieldId !== "string" || !fieldId) {
        throw new Error("Customer field ID is required.");
      }

      if (direction !== "up" && direction !== "down") {
        throw new Error("Invalid movement direction.");
      }

      await moveStyleField(session.shop, styleId, fieldId, direction);

      return redirect(`/app/styles/${styleId}/fields?notice=fields-reordered`);
    }

    if (intent === "reorderFields") {
      const orderedFieldIds = formData
        .getAll("fieldId")
        .filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0,
        );

      if (orderedFieldIds.length === 0) {
        throw new Error("Customer field order is required.");
      }

      await reorderStyleFields(session.shop, styleId, orderedFieldIds);

      return redirect(`/app/styles/${styleId}/fields?notice=fields-reordered`);
    }

    throw new Error("Unsupported customer field action.");
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not update customer inputs.",
    };
  }
};

const notices: Record<string, string> = {
  "field-added": "Customer field added",

  "field-updated": "Customer field updated",

  "field-deleted": "Customer field deleted",

  "fields-reordered": "Customer fields reordered",
};

export default function StyleFields() {
  const { styleId, notice, editable, fields } = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();

  const shopify = useAppBridge();

  const backNav = useNavigatingTo();

  const nextNav = useNavigatingTo();

  useEffect(() => {
    if (!notice) {
      return;
    }

    const message = notices[notice];

    if (!message) {
      return;
    }

    shopify.toast.show(message);

    // A successful add/edit/delete/reorder leaves its triggering modal
    // (if any) still open, showing stale submitted content behind the
    // toast, with its submit button re-enabled as if nothing happened.
    // s-modal exposes hideOverlay() directly on the element — closing
    // every modal here is simplest and harmless for ones already
    // closed, and covers per-row edit/delete modals without needing to
    // know which field's modal was open.
    document
      .querySelectorAll<HTMLElement & { hideOverlay?: () => void }>("s-modal")
      .forEach((modal) => modal.hideOverlay?.());

    // A plain URL cleanup, not a real navigation — history.replaceState
    // avoids a spurious loader revalidation that would otherwise flash
    // every submit button on this page into a loading state.
    window.history.replaceState(null, "", `/app/styles/${styleId}/fields`);
  }, [notice, shopify, styleId]);

  const hasImageField = fields.some((field) => field.type === "IMAGE");

  return (
    <s-stack direction="block" gap="base">
      {actionData?.error ? (
        <s-banner tone="critical" heading="Could not update customer inputs">
          <s-paragraph>{actionData.error}</s-paragraph>
        </s-banner>
      ) : null}

      {!hasImageField ? (
        <s-banner tone="warning" heading="Add an image upload field">
          <s-paragraph>
            Customer personalization relies on a photo upload. Add a required
            Image field before publishing this prompt.
          </s-paragraph>
        </s-banner>
      ) : null}

      <CustomerFields fields={fields} editable={editable} />

      <s-stack direction="inline" gap="base">
        <s-button
          href={`/app/styles/${styleId}/generation`}
          loading={backNav.loading}
          onClick={backNav.onClick}
        >
          Back
        </s-button>

        <s-button
          href={`/app/styles/${styleId}/publish`}
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
