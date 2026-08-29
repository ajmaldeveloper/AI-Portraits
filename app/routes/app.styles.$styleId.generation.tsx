import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  ASPECT_RATIO_OPTIONS,
  QUALITY_OPTIONS,
  isKnownAspectRatio,
  isKnownQuality,
} from "../services/settings/generation-defaults.server";
import {
  requireStyleForShop,
  styleCanBeEdited,
  updateStyleDraft,
} from "../services/styles/style.server";
import { authenticate } from "../shopify.server";
import { useNavigatingTo } from "../utils/use-navigating-to";

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

  const editable = styleCanBeEdited(style);

  return {
    styleId,

    editable,

    aspectRatioOptions: ASPECT_RATIO_OPTIONS,

    qualityOptions: QUALITY_OPTIONS,

    values: {
      outputAspectRatio: style.outputAspectRatio,

      outputQuality: style.outputQuality,

      previewCount: String(style.previewCount),
    },
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

  const outputAspectRatio = value(formData, "outputAspectRatio");

  const outputQuality = value(formData, "outputQuality");

  const previewCount = Number(value(formData, "previewCount"));

  if (!isKnownAspectRatio(outputAspectRatio)) {
    return {
      error: "Choose a supported artwork aspect ratio.",
    };
  }

  if (!isKnownQuality(outputQuality)) {
    return {
      error: "Choose a supported output quality.",
    };
  }

  if (!Number.isInteger(previewCount) || previewCount < 1 || previewCount > 4) {
    return {
      error: "Example images per prompt must be between 1 and 4.",
    };
  }

  try {
    await updateStyleDraft(session.shop, styleId, {
      outputAspectRatio,
      outputQuality,
      previewCount,
    });

    return redirect(`/app/styles/${styleId}/fields`);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not save generation settings.",
    };
  }
};

export default function StyleGeneration() {
  const { styleId, editable, aspectRatioOptions, qualityOptions, values } =
    useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();

  const navigation = useNavigation();

  // Scoped to an actual form submission (formData present), not just any
  // pending navigation — a bare loading/GET transition must not flash
  // this button into a loading state.
  const submitting =
    navigation.state !== "idle" && Boolean(navigation.formData);

  const backNav = useNavigatingTo();

  const nextNav = useNavigatingTo();

  return (
    <s-stack direction="block" gap="base">
      {actionData?.error ? (
        <s-banner tone="critical" heading="Could not save generation settings">
          <s-paragraph>{actionData.error}</s-paragraph>
        </s-banner>
      ) : null}

      <s-section heading="Generation output">
        <Form method="post">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Overrides this prompt&rsquo;s{" "}
              <s-link href="/app/settings">shop-wide defaults</s-link> for image
              output.
            </s-paragraph>

            <s-query-container>
              <s-grid
                gridTemplateColumns="@container (inline-size > 640px) 1fr 1fr 1fr, 1fr"
                gap="base"
              >
                <s-select
                  label="Artwork aspect ratio"
                  name="outputAspectRatio"
                  value={values.outputAspectRatio}
                  disabled={!editable}
                >
                  {aspectRatioOptions.map((option) => (
                    <s-option key={option.id} value={option.id}>
                      {option.label}
                    </s-option>
                  ))}
                </s-select>

                <s-select
                  label="Output quality"
                  name="outputQuality"
                  value={values.outputQuality}
                  disabled={!editable}
                >
                  {qualityOptions.map((option) => (
                    <s-option key={option.id} value={option.id}>
                      {option.label}
                    </s-option>
                  ))}
                </s-select>

                <s-number-field
                  label="Example images per prompt"
                  name="previewCount"
                  defaultValue={values.previewCount}
                  min={1}
                  max={4}
                  step={1}
                  disabled={!editable}
                  autocomplete="off"
                  details="Results requested per generation job."
                />
              </s-grid>
            </s-query-container>

            <s-stack direction="inline" gap="base">
              <s-button
                href={`/app/styles/${styleId}/media`}
                loading={backNav.loading}
                onClick={backNav.onClick}
                disabled={submitting}
              >
                Back
              </s-button>

              {editable ? (
                <s-button
                  type="submit"
                  variant="primary"
                  loading={submitting}
                  disabled={submitting}
                >
                  Next
                </s-button>
              ) : (
                <s-button
                  href={`/app/styles/${styleId}/fields`}
                  variant="primary"
                  loading={nextNav.loading}
                  onClick={nextNav.onClick}
                >
                  Next
                </s-button>
              )}
            </s-stack>
          </s-stack>
        </Form>
      </s-section>
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
