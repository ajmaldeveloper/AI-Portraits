import { Form, useNavigation } from "react-router";

import type { StyleFormValues } from "../../utils/style-form";
import { useNavigatingTo } from "../../utils/use-navigating-to";

type StyleFormProps = {
  values: StyleFormValues;
  cancelHref: string;
  error?: string;
};

export function StyleForm({ values, cancelHref, error }: StyleFormProps) {
  const navigation = useNavigation();

  // Scoped to an actual form submission (formData present), not just any
  // pending navigation — a bare loading/GET transition must not flash
  // this button into a loading state.
  const submitting =
    navigation.state !== "idle" && Boolean(navigation.formData);

  const cancelNav = useNavigatingTo();

  return (
    <Form method="post">
      <s-stack direction="block" gap="base">
        {error ? (
          <s-banner tone="critical" heading="Could not save prompt">
            <s-paragraph>{error}</s-paragraph>
          </s-banner>
        ) : null}

        <s-section heading="Internal name">
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Internal name"
              name="name"
              defaultValue={values.name}
              required
              autocomplete="off"
              details="Used to identify this AI transformation in your admin — customers never see it."
            />
          </s-stack>
        </s-section>

        <s-section heading="AI transformation">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Describe the transformation itself. The same engine can support
              watercolor, oil painting, royal portraits, cartoons, pets,
              families, or other image styles.
            </s-paragraph>

            <s-text-area
              label="Transformation prompt"
              name="prompt"
              defaultValue={values.prompt}
              rows={9}
              autocomplete="off"
              details="Explain what should change and what must remain faithful to the customer upload."
            />
          </s-stack>
        </s-section>

        <s-stack direction="inline" gap="base">
          <s-button
            type="submit"
            variant="primary"
            loading={submitting}
            disabled={submitting}
          >
            Next
          </s-button>

          <s-button
            href={cancelHref}
            disabled={submitting}
            loading={cancelNav.loading}
            onClick={cancelNav.onClick}
          >
            Cancel
          </s-button>
        </s-stack>
      </s-stack>
    </Form>
  );
}
