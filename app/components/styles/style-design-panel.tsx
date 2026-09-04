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
  swatchGapPx: number | null;
  swatchBorderColor: string | null;
  swatchActiveBorderColor: string | null;
  swatchRadiusPx: number | null;
  swatchBackgroundColor: string | null;
  swatchActiveBackgroundColor: string | null;
  swatchFullBleed: boolean;
};

type DesignFormState = {
  swatchWidthPx: string;
  swatchHeightPx: string;
  swatchFontSizePx: string;
  swatchWidthMobilePx: string;
  swatchHeightMobilePx: string;
  swatchFontSizeMobilePx: string;
  swatchGapPx: string;
  swatchBorderColor: string;
  swatchActiveBorderColor: string;
  swatchRadiusPx: string;
  swatchBackgroundColor: string;
  swatchActiveBackgroundColor: string;
  swatchFullBleed: boolean;
};

function checkedValue(event: Event): boolean {
  const target = event.currentTarget as { checked?: boolean } | null;
  return target?.checked ?? false;
}

function numToStr(value: number | null) {
  return value !== null ? String(value) : "";
}

// A color field always shows *some* swatch (there's no "blank" state
// for a native color picker) — these are the exact hex values the
// storefront's own CSS falls back to (see ai-art-generator.css's
// --aig-border/--aig-focus and .aig-choice-chip's own background
// defaults), so an unset field shows the real current color instead
// of an empty white box that looks unset but isn't.
const DEFAULT_BORDER_COLOR = "#d1d1d1";
const DEFAULT_ACTIVE_BORDER_COLOR = "#005bd3";
const DEFAULT_BACKGROUND_COLOR = "#ffffff";
const DEFAULT_ACTIVE_BACKGROUND_COLOR = "#f6f6f7";

function toFormState(values: StyleDesignValues): DesignFormState {
  return {
    swatchWidthPx: numToStr(values.swatchWidthPx),
    swatchHeightPx: numToStr(values.swatchHeightPx),
    swatchFontSizePx: numToStr(values.swatchFontSizePx),
    swatchWidthMobilePx: numToStr(values.swatchWidthMobilePx),
    swatchHeightMobilePx: numToStr(values.swatchHeightMobilePx),
    swatchFontSizeMobilePx: numToStr(values.swatchFontSizeMobilePx),
    swatchGapPx: numToStr(values.swatchGapPx),
    swatchBorderColor: values.swatchBorderColor ?? DEFAULT_BORDER_COLOR,
    swatchActiveBorderColor:
      values.swatchActiveBorderColor ?? DEFAULT_ACTIVE_BORDER_COLOR,
    swatchRadiusPx: numToStr(values.swatchRadiusPx),
    swatchBackgroundColor: values.swatchBackgroundColor ?? DEFAULT_BACKGROUND_COLOR,
    swatchActiveBackgroundColor:
      values.swatchActiveBackgroundColor ?? DEFAULT_ACTIVE_BACKGROUND_COLOR,
    swatchFullBleed: values.swatchFullBleed,
  };
}

/**
 * Swatch size, spacing, colors, and label font size — global to the
 * whole Style, applying uniformly to every Product option's choice
 * swatches rather than being set per option. Its own dedicated tab
 * (see app.styles.$styleId.tsx / app.styles.$styleId.design.tsx),
 * next to Product options.
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

  const submitting = navigation.state !== "idle";

  const isDirty = JSON.stringify(values) !== JSON.stringify(initialValues);

  const onChange = (patch: Partial<DesignFormState>) =>
    setValues((current) => ({ ...current, ...patch }));

  return (
    <Form method="post">
      <s-stack direction="block" gap="base">
        <s-section heading="Size">
          <s-stack direction="block" gap="base">
            <s-query-container>
              <s-grid gridTemplateColumns="@container (inline-size > 360px) 1fr 1fr 1fr, 1fr" gap="base">
                <s-number-field
                  label="Width"
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
                  label="Height"
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

                <s-number-field
                  label="Corner radius"
                  name="swatchRadiusPx"
                  value={values.swatchRadiusPx}
                  onInput={(event: Event) => onChange({ swatchRadiusPx: eventValue(event) })}
                  min={0}
                  step={1}
                  suffix="px"
                  autocomplete="off"
                  placeholder="8"
                  disabled={!editable}
                />
              </s-grid>
            </s-query-container>

            <s-query-container>
              <s-grid gridTemplateColumns="@container (inline-size > 360px) 1fr 1fr, 1fr" gap="base">
                <s-number-field
                  label="Label font size"
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

                <s-number-field
                  label="Gap between choices"
                  name="swatchGapPx"
                  value={values.swatchGapPx}
                  onInput={(event: Event) => onChange({ swatchGapPx: eventValue(event) })}
                  min={1}
                  step={1}
                  suffix="px"
                  autocomplete="off"
                  placeholder="8"
                  disabled={!editable}
                />
              </s-grid>
            </s-query-container>
          </s-stack>
        </s-section>

        <s-section heading="Colors">
          <s-stack direction="block" gap="base">
            <s-query-container>
              <s-grid gridTemplateColumns="@container (inline-size > 360px) 1fr 1fr, 1fr" gap="base">
                <s-color-field
                  label="Border"
                  name="swatchBorderColor"
                  value={values.swatchBorderColor}
                  onInput={(event: Event) => onChange({ swatchBorderColor: eventValue(event) })}
                  disabled={!editable}
                />

                <s-color-field
                  label="Selected border"
                  name="swatchActiveBorderColor"
                  value={values.swatchActiveBorderColor}
                  onInput={(event: Event) =>
                    onChange({ swatchActiveBorderColor: eventValue(event) })
                  }
                  disabled={!editable}
                />
              </s-grid>
            </s-query-container>

            <s-query-container>
              <s-grid gridTemplateColumns="@container (inline-size > 360px) 1fr 1fr, 1fr" gap="base">
                <s-color-field
                  label="Background"
                  name="swatchBackgroundColor"
                  value={values.swatchBackgroundColor}
                  onInput={(event: Event) =>
                    onChange({ swatchBackgroundColor: eventValue(event) })
                  }
                  disabled={!editable}
                />

                <s-color-field
                  label="Selected background"
                  name="swatchActiveBackgroundColor"
                  value={values.swatchActiveBackgroundColor}
                  onInput={(event: Event) =>
                    onChange({ swatchActiveBackgroundColor: eventValue(event) })
                  }
                  disabled={!editable}
                />
              </s-grid>
            </s-query-container>
          </s-stack>
        </s-section>

        <s-section heading="Photo choices">
          <s-checkbox
            label="Full-bleed"
            name="swatchFullBleed"
            value="yes"
            checked={values.swatchFullBleed}
            onInput={(event: Event) => onChange({ swatchFullBleed: checkedValue(event) })}
            details="A choice's own photo fills its whole chip, with the label overlaid."
            disabled={!editable}
          />
        </s-section>

        <s-section heading="Mobile overrides">
          <s-stack direction="block" gap="base">
            <s-query-container>
              <s-grid gridTemplateColumns="@container (inline-size > 360px) 1fr 1fr, 1fr" gap="base">
                <s-number-field
                  label="Width"
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
                  label="Height"
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
              label="Label font size"
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
          </s-stack>
        </s-section>

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
  );
}
