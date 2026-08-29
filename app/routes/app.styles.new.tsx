import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData } from "react-router";

import { StyleForm } from "../components/styles/style-form";
import { createStyleDraft } from "../services/styles/style.server";
import { authenticate } from "../shopify.server";
import { initialStyleFormValues } from "../utils/style-form";
import { parseStyleForm } from "../utils/style-form.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);

  const formData = await request.formData();

  const parsed = parseStyleForm(formData);

  if (!parsed.input) {
    return {
      error: parsed.error ?? "Check the form and try again.",
      values: parsed.values,
    };
  }

  try {
    // Product details and generation output are left unset here — they
    // default to the shop's Settings defaults (generation output) and
    // to the style name (product title) until the next steps fill them
    // in, matching every other style's draft data shape.
    const style = await createStyleDraft(session.shop, parsed.input);

    return redirect(`/app/styles/${style.id}?created=1`);
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Could not create prompt.",
      values: parsed.values,
    };
  }
};

export default function NewStyle() {
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading="Create prompt" inlineSize="small">
      <s-link slot="breadcrumb-actions" href="/app/styles">
        Prompts
      </s-link>

      <StyleForm
        values={actionData?.values ?? initialStyleFormValues}
        error={actionData?.error}
        cancelHref="/app/styles"
      />

      <s-section slot="aside" heading="Creation steps">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-badge tone="info">1</s-badge>

            <s-text type="strong">Prompt</s-text>
          </s-stack>

          <s-paragraph>Name and transformation prompt.</s-paragraph>

          <s-stack direction="inline" gap="small" alignItems="center">
            <s-badge>2</s-badge>

            <s-text type="strong">Product</s-text>
          </s-stack>

          <s-paragraph>
            Shopify product title, description, and price.
          </s-paragraph>

          <s-stack direction="inline" gap="small" alignItems="center">
            <s-badge>3</s-badge>

            <s-text type="strong">Generation</s-text>
          </s-stack>

          <s-paragraph>
            Override aspect ratio, quality, and example count.
          </s-paragraph>

          <s-stack direction="inline" gap="small" alignItems="center">
            <s-badge>4</s-badge>

            <s-text type="strong">Customer inputs</s-text>
          </s-stack>

          <s-paragraph>
            Fields customers fill in, like their photo upload.
          </s-paragraph>

          <s-stack direction="inline" gap="small" alignItems="center">
            <s-badge>5</s-badge>

            <s-text type="strong">Media</s-text>
          </s-stack>

          <s-paragraph>Generate and choose product example images.</s-paragraph>

          <s-stack direction="inline" gap="small" alignItems="center">
            <s-badge>6</s-badge>

            <s-text type="strong">Publish</s-text>
          </s-stack>

          <s-paragraph>Creates the linked Shopify product.</s-paragraph>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Automatic setup">
        <s-unordered-list>
          <s-list-item>
            Nothing is added to your Shopify catalog until you publish.
          </s-list-item>

          <s-list-item>
            Product title defaults to the style name until you set one on the
            Product step.
          </s-list-item>

          <s-list-item>
            Generation output defaults to your{" "}
            <s-link href="/app/settings">Settings</s-link> until you override it
            on the Generation step.
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}
