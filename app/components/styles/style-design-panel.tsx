import { useState } from "react";
import { Form, useNavigation } from "react-router";

import { eventValue } from "../../utils/event-value";

export type StyleDesignValues = {
  swatchWidthPx: number | null;
  swatchHeightPx: number | null;
  swatchFontSizePx: number | null;
  swatchWidthMobilePx: number | null;
  swatchHeightMobilePx: number | null;
  swatchFontSizeMobilePx: number | null;
};

type DesignFormState = {
  swatchWidthPx: string;
  swatchHeightPx: string;
  swatchFontSizePx: string;
  swatchWidthMobilePx: string;
  swatchHeightMobilePx: string;
  swatchFontSizeMobilePx: string;
};

function toFormState(values: StyleDesignValues): DesignFormState {
  return {
    swatchWidthPx: values.swatchWidthPx !== null ? String(values.swatchWidthPx) : "",
    swatchHeightPx: values.swatchHeightPx !== null ? String(values.swatchHeightPx) : "",
    swatchFontSizePx:
      values.swatchFontSizePx !== null ? String(values.swatchFontSizePx) : "",
    swatchWidthMobilePx:
      values.swatchWidthMobilePx !== null ? String(values.swatchWidthMobilePx) : "",
    swatchHeightMobilePx:
      values.swatchHeightMobilePx !== null ? String(values.swatchHeightMobilePx) : "",
    swatchFontSizeMobilePx:
      values.swatchFontSizeMobilePx !== null
        ? String(values.swatchFontSizeMobilePx)
        : "",
  };
}

/**
 * Swatch box size / label font size — global to the whole Style,
 * applying uniformly to every Product option's choice swatches rather
 * than being set per option. Lives in the Product options tab's
 * sidebar (only rendered there — see app.styles.$styleId.tsx), but
 * submits to that tab's own route regardless of which tab actually
 * renders it, since that route owns the intent handling.
 */
export function StyleDesignPanel({
  styleId,
  values: initialValuesRaw,
  editable,
}: {
  styleId: string;
  values: StyleDesignValues;
  editable: boolean;
}) {
  const initialValues = toFormState(initialValuesRaw);

  const [values, setValues] = useState<DesignFormState>(initialValues);

  const navigation = useNavigation();

  const submitting =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "saveDesign";

  const isDirty = JSON.stringify(values) !== JSON.stringify(initialValues);

  const onChange = (patch: Partial<DesignFormState>) =>
    setValues((current) => ({ ...current, ...patch }));

  return (
    <s-section heading="Swatch design">
      <Form method="post" action={`/app/styles/${styleId}/options`}>
        <input type="hidden" name="intent" value="saveDesign" />

        <s-stack direction="block" gap="base">
          <s-text color="subdued">
            Applies to every option's choice swatches on this product.
          </s-text>

          <s-query-container>
            <s-grid gridTemplateColumns="@container (inline-size > 280px) 1fr 1fr, 1fr" gap="base">
              <s-number-field
                label="Width (px)"
                name="swatchWidthPx"
                value={values.swatchWidthPx}
                onInput={(event: Event) => onChange({ swatchWidthPx: eventValue(event) })}
                min={1}
                step={1}
                suffix="px"
                autocomplete="off"
                placeholder="64"
                disabled={!editable}
              />

              <s-number-field
                label="Height (px)"
                name="swatchHeightPx"
                value={values.swatchHeightPx}
                onInput={(event: Event) => onChange({ swatchHeightPx: eventValue(event) })}
                min={1}
                step={1}
                suffix="px"
                autocomplete="off"
                placeholder="40"
                disabled={!editable}
              />
            </s-grid>
          </s-query-container>

          <s-number-field
            label="Label font size (px)"
            name="swatchFontSizePx"
            value={values.swatchFontSizePx}
            onInput={(event: Event) => onChange({ swatchFontSizePx: eventValue(event) })}
            min={1}
            step={1}
            suffix="px"
            autocomplete="off"
            placeholder="13"
            disabled={!editable}
          />

          <s-text type="strong">Mobile</s-text>

          <s-query-container>
            <s-grid gridTemplateColumns="@container (inline-size > 280px) 1fr 1fr, 1fr" gap="base">
              <s-number-field
                label="Width (px)"
                name="swatchWidthMobilePx"
                value={values.swatchWidthMobilePx}
                onInput={(event: Event) =>
                  onChange({ swatchWidthMobilePx: eventValue(event) })
                }
                min={1}
                step={1}
                suffix="px"
                autocomplete="off"
                placeholder="same as desktop"
                disabled={!editable}
              />

              <s-number-field
                label="Height (px)"
                name="swatchHeightMobilePx"
                value={values.swatchHeightMobilePx}
                onInput={(event: Event) =>
                  onChange({ swatchHeightMobilePx: eventValue(event) })
                }
                min={1}
                step={1}
                suffix="px"
                autocomplete="off"
                placeholder="same as desktop"
                disabled={!editable}
              />
            </s-grid>
          </s-query-container>

          <s-number-field
            label="Label font size (px)"
            name="swatchFontSizeMobilePx"
            value={values.swatchFontSizeMobilePx}
            onInput={(event: Event) =>
              onChange({ swatchFontSizeMobilePx: eventValue(event) })
            }
            min={1}
            step={1}
            suffix="px"
            autocomplete="off"
            placeholder="same as desktop"
            disabled={!editable}
          />

          <s-button
            type="submit"
            variant="primary"
            loading={submitting}
            disabled={!editable || !isDirty || submitting}
          >
            Save design
          </s-button>
        </s-stack>
      </Form>
    </s-section>
  );
}
