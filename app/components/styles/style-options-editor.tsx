import { useEffect, useState } from "react";
import { move } from "@dnd-kit/helpers";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { Form, useNavigation, useSubmit } from "react-router";

import { eventValue } from "../../utils/event-value";

export const OPTION_TYPES = [
  { value: "TEXT", label: "Text" },
  { value: "COLOR_SWATCH", label: "Color swatch" },
] as const;

// A real (non-empty) sentinel for "no axis" — s-select/s-option don't
// reliably submit an option whose value is the empty string, so this
// avoids that rather than depending on it.
export const AXIS_ROLE_NONE = "NONE";

export const AXIS_ROLES = [
  { value: AXIS_ROLE_NONE, label: "None" },
  { value: "SIZE", label: "Size" },
  { value: "FRAMING", label: "Framing" },
] as const;

export const IMAGE_ORIENTATIONS = [
  { value: "HORIZONTAL", label: "Horizontal" },
  { value: "VERTICAL", label: "Vertical" },
] as const;

export const IMAGE_FITS = [
  { value: "FILL", label: "Fill" },
  { value: "ORIGINAL", label: "Original" },
] as const;

export type OptionChoiceView = {
  id: string;
  label: string;
  priceDelta: string;
  compareAtPriceDelta: string;
  requiresShipping: boolean;
  scalePercent: number | null;
  hexColor: string;
  imageAssetId: string | null;
  imageUrl: string | null;
  borderThicknessPx: number | null;
  matThicknessPx: number | null;
  borderRadiusPx: number | null;
};

export type OptionView = {
  id: string;
  label: string;
  type: string;
  axisRole: string | null;
  imageOrientation: string;
  imageFit: string;
  swatchWidthPx: number | null;
  swatchHeightPx: number | null;
  swatchFontSizePx: number | null;
  swatchWidthMobilePx: number | null;
  swatchHeightMobilePx: number | null;
  swatchFontSizeMobilePx: number | null;
  choices: OptionChoiceView[];
};

function typeLabel(type: string) {
  return OPTION_TYPES.find((entry) => entry.value === type)?.label ?? type;
}

function axisRoleLabel(axisRole: string | null) {
  if (!axisRole) return null;
  return axisRole === "SIZE" ? "Drives Size" : "Drives Framing";
}

// --- Option (top-level) form -----------------------------------------

type OptionFormState = {
  label: string;
  type: string;
  axisRole: string;
  imageOrientation: string;
  imageFit: string;
  swatchWidthPx: string;
  swatchHeightPx: string;
  swatchFontSizePx: string;
  swatchWidthMobilePx: string;
  swatchHeightMobilePx: string;
  swatchFontSizeMobilePx: string;
};

const blankOptionValues: OptionFormState = {
  label: "",
  type: "TEXT",
  axisRole: AXIS_ROLE_NONE,
  imageOrientation: "HORIZONTAL",
  imageFit: "FILL",
  swatchWidthPx: "",
  swatchHeightPx: "",
  swatchFontSizePx: "",
  swatchWidthMobilePx: "",
  swatchHeightMobilePx: "",
  swatchFontSizeMobilePx: "",
};

function optionValuesOf(option: OptionView): OptionFormState {
  return {
    label: option.label,
    type: option.type,
    axisRole: option.axisRole ?? AXIS_ROLE_NONE,
    imageOrientation: option.imageOrientation,
    imageFit: option.imageFit,
    swatchWidthPx: option.swatchWidthPx !== null ? String(option.swatchWidthPx) : "",
    swatchHeightPx: option.swatchHeightPx !== null ? String(option.swatchHeightPx) : "",
    swatchFontSizePx:
      option.swatchFontSizePx !== null ? String(option.swatchFontSizePx) : "",
    swatchWidthMobilePx:
      option.swatchWidthMobilePx !== null ? String(option.swatchWidthMobilePx) : "",
    swatchHeightMobilePx:
      option.swatchHeightMobilePx !== null ? String(option.swatchHeightMobilePx) : "",
    swatchFontSizeMobilePx:
      option.swatchFontSizeMobilePx !== null
        ? String(option.swatchFontSizeMobilePx)
        : "",
  };
}

type OptionFormErrors = Partial<Record<keyof OptionFormState, string>>;

function validateOptionForm(
  values: OptionFormState,
  otherLabels: string[],
): OptionFormErrors {
  const errors: OptionFormErrors = {};

  const label = values.label.trim();

  if (!label) {
    errors.label = "Name is required.";
  } else if (
    otherLabels.some((existing) => existing.toLowerCase() === label.toLowerCase())
  ) {
    errors.label = "An option with this name already exists.";
  }

  const positiveIntFields: Array<keyof OptionFormState> = [
    "swatchWidthPx",
    "swatchHeightPx",
    "swatchFontSizePx",
    "swatchWidthMobilePx",
    "swatchHeightMobilePx",
    "swatchFontSizeMobilePx",
  ];

  for (const field of positiveIntFields) {
    const raw = values[field].trim();

    if (!raw) {
      continue;
    }

    const parsed = Number(raw);

    if (!Number.isInteger(parsed) || parsed < 1) {
      errors[field] = "Must be a positive whole number of pixels.";
    }
  }

  return errors;
}

function OptionFormFields({
  values,
  errors,
  takenAxisRoles,
  onChange,
}: {
  values: OptionFormState;
  errors: OptionFormErrors;
  takenAxisRoles: Set<string>;
  onChange: (patch: Partial<OptionFormState>) => void;
}) {
  return (
    <s-stack direction="block" gap="base">
      <s-text-field
        label="Name"
        name="label"
        value={values.label}
        onInput={(event: Event) => onChange({ label: eventValue(event) })}
        placeholder="e.g. Size, Framing, Mat color"
        required
        autocomplete="off"
        error={errors.label}
      />

      <s-select
        label="Type"
        name="type"
        value={values.type}
        onChange={(event: Event) => onChange({ type: eventValue(event) })}
        details="How each choice looks to customers: Text is a plain labeled button (e.g. 8 x 10 in), Color swatch is a clickable color circle. Either way, every choice can also have its own photo — set that per choice below."
      >
        {OPTION_TYPES.map((entry) => (
          <s-option key={entry.value} value={entry.value}>
            {entry.label}
          </s-option>
        ))}
      </s-select>

      <s-select
        label="Axis"
        name="axisRole"
        value={values.axisRole}
        onChange={(event: Event) => onChange({ axisRole: eventValue(event) })}
        details="At most one option can drive Size, and at most one can drive Framing. Any option's choices can optionally carry a price, regardless of axis."
      >
        {AXIS_ROLES.map((entry) => (
          <s-option
            key={entry.value}
            value={entry.value}
            disabled={
              entry.value !== AXIS_ROLE_NONE &&
              entry.value !== values.axisRole &&
              takenAxisRoles.has(entry.value)
            }
          >
            {entry.label}
          </s-option>
        ))}
      </s-select>

      <s-query-container>
        <s-grid gridTemplateColumns="@container (inline-size > 360px) 1fr 1fr, 1fr" gap="base">
          <s-select
            label="Image orientation"
            name="imageOrientation"
            value={values.imageOrientation}
            onChange={(event: Event) => onChange({ imageOrientation: eventValue(event) })}
            details="How choice images (if any are attached below) are shaped on the storefront."
          >
            {IMAGE_ORIENTATIONS.map((entry) => (
              <s-option key={entry.value} value={entry.value}>
                {entry.label}
              </s-option>
            ))}
          </s-select>

          <s-select
            label="Image fit"
            name="imageFit"
            value={values.imageFit}
            onChange={(event: Event) => onChange({ imageFit: eventValue(event) })}
            details="Fill crops the photo to fill the shape. Original shows the whole photo, uncropped."
          >
            {IMAGE_FITS.map((entry) => (
              <s-option key={entry.value} value={entry.value}>
                {entry.label}
              </s-option>
            ))}
          </s-select>
        </s-grid>
      </s-query-container>

      <s-text type="strong">Swatch size (desktop)</s-text>

      <s-query-container>
        <s-grid gridTemplateColumns="@container (inline-size > 480px) 1fr 1fr 1fr, 1fr" gap="base">
          <s-number-field
            label="Width (px)"
            name="swatchWidthPx"
            value={values.swatchWidthPx}
            onInput={(event: Event) => onChange({ swatchWidthPx: eventValue(event) })}
            min={1}
            step={1}
            suffix="px"
            autocomplete="off"
            placeholder={values.imageOrientation === "VERTICAL" ? "40" : "64"}
            error={errors.swatchWidthPx}
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
            placeholder={values.imageOrientation === "VERTICAL" ? "64" : "40"}
            error={errors.swatchHeightPx}
          />

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
            error={errors.swatchFontSizePx}
          />
        </s-grid>
      </s-query-container>

      <s-text type="strong">Swatch size (mobile)</s-text>

      <s-query-container>
        <s-grid gridTemplateColumns="@container (inline-size > 480px) 1fr 1fr 1fr, 1fr" gap="base">
          <s-number-field
            label="Width (px)"
            name="swatchWidthMobilePx"
            value={values.swatchWidthMobilePx}
            onInput={(event: Event) => onChange({ swatchWidthMobilePx: eventValue(event) })}
            min={1}
            step={1}
            suffix="px"
            autocomplete="off"
            placeholder="same as desktop"
            error={errors.swatchWidthMobilePx}
          />

          <s-number-field
            label="Height (px)"
            name="swatchHeightMobilePx"
            value={values.swatchHeightMobilePx}
            onInput={(event: Event) => onChange({ swatchHeightMobilePx: eventValue(event) })}
            min={1}
            step={1}
            suffix="px"
            autocomplete="off"
            placeholder="same as desktop"
            error={errors.swatchHeightMobilePx}
          />

          <s-number-field
            label="Label font size (px)"
            name="swatchFontSizeMobilePx"
            value={values.swatchFontSizeMobilePx}
            onInput={(event: Event) => onChange({ swatchFontSizeMobilePx: eventValue(event) })}
            min={1}
            step={1}
            suffix="px"
            autocomplete="off"
            placeholder="same as desktop"
            error={errors.swatchFontSizeMobilePx}
          />
        </s-grid>
      </s-query-container>
    </s-stack>
  );
}

function AddOptionModal({
  submitting,
  resetSignal,
  existingLabels,
  takenAxisRoles,
}: {
  submitting: boolean;
  resetSignal: number;
  existingLabels: string[];
  takenAxisRoles: Set<string>;
}) {
  const [values, setValues] = useState<OptionFormState>(blankOptionValues);

  const [errors, setErrors] = useState<OptionFormErrors>({});

  const dirty = values.label.trim().length > 0;

  const reset = () => {
    setValues(blankOptionValues);
    setErrors({});
  };

  // Resets in place, not via remounting — a React key-based remount
  // races with the trigger button's native --show command, which
  // targets the modal element by DOM id; the old element could be torn
  // down and replaced by a new one before the show command reaches it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reset, [resetSignal]);

  return (
    <s-modal id="add-option" heading="Add option">
      <Form
        method="post"
        onSubmit={(event) => {
          const validationErrors = validateOptionForm(values, existingLabels);

          if (Object.keys(validationErrors).length > 0) {
            event.preventDefault();
            setErrors(validationErrors);
          }
        }}
      >
        <input type="hidden" name="intent" value="addOption" />

        <s-stack direction="block" gap="base">
          <OptionFormFields
            values={values}
            errors={errors}
            takenAxisRoles={takenAxisRoles}
            onChange={(patch) => {
              setValues((current) => ({ ...current, ...patch }));
              setErrors((current) => {
                const next = { ...current };
                for (const key of Object.keys(patch) as Array<keyof OptionFormState>) {
                  delete next[key];
                }
                return next;
              });
            }}
          />

          <s-stack direction="inline" gap="base">
            <s-button type="submit" variant="primary" loading={submitting} disabled={!dirty || submitting}>
              Add option
            </s-button>

            <s-button
              variant="secondary"
              commandFor="add-option"
              command="--hide"
              onClick={reset}
              disabled={submitting}
            >
              Cancel
            </s-button>
          </s-stack>
        </s-stack>
      </Form>
    </s-modal>
  );
}

function EditOptionModal({
  option,
  submitting,
  otherLabels,
  takenAxisRoles,
}: {
  option: OptionView;
  submitting: boolean;
  otherLabels: string[];
  takenAxisRoles: Set<string>;
}) {
  const initialValues = optionValuesOf(option);

  const [values, setValues] = useState<OptionFormState>(initialValues);

  const [errors, setErrors] = useState<OptionFormErrors>({});

  const isDirty = JSON.stringify(values) !== JSON.stringify(initialValues);

  return (
    <s-modal id={`edit-option-${option.id}`} heading={`Edit ${option.label}`}>
      <Form
        method="post"
        onSubmit={(event) => {
          const validationErrors = validateOptionForm(values, otherLabels);

          if (Object.keys(validationErrors).length > 0) {
            event.preventDefault();
            setErrors(validationErrors);
            return;
          }

          setErrors({});
        }}
      >
        <input type="hidden" name="intent" value="editOption" />
        <input type="hidden" name="optionId" value={option.id} />

        <s-stack direction="block" gap="base">
          <OptionFormFields
            values={values}
            errors={errors}
            takenAxisRoles={takenAxisRoles}
            onChange={(patch) => {
              setValues((current) => ({ ...current, ...patch }));
              setErrors((current) => {
                const next = { ...current };
                for (const key of Object.keys(patch) as Array<keyof OptionFormState>) {
                  delete next[key];
                }
                return next;
              });
            }}
          />

          <s-stack direction="inline" gap="base">
            <s-button type="submit" variant="primary" loading={submitting} disabled={!isDirty || submitting}>
              Save changes
            </s-button>

            <s-button
              variant="secondary"
              commandFor={`edit-option-${option.id}`}
              command="--hide"
              onClick={() => {
                setValues(initialValues);
                setErrors({});
              }}
              disabled={submitting}
            >
              Cancel
            </s-button>
          </s-stack>
        </s-stack>
      </Form>
    </s-modal>
  );
}

// --- Choice (nested under an option) form ------------------------------

type ChoiceFormState = {
  label: string;
  priceDelta: string;
  compareAtPriceDelta: string;
  requiresShipping: boolean;
  scalePercent: string;
  hexColor: string;
  borderThicknessPx: string;
  matThicknessPx: string;
  borderRadiusPx: string;
};

const blankChoiceValues: ChoiceFormState = {
  label: "",
  priceDelta: "",
  compareAtPriceDelta: "",
  requiresShipping: false,
  scalePercent: "100",
  hexColor: "#1a1a1a",
  borderThicknessPx: "24",
  matThicknessPx: "",
  borderRadiusPx: "",
};

function choiceValuesOf(choice: OptionChoiceView): ChoiceFormState {
  return {
    label: choice.label,
    priceDelta: choice.priceDelta || "0",
    compareAtPriceDelta: choice.compareAtPriceDelta,
    requiresShipping: choice.requiresShipping,
    scalePercent: choice.scalePercent ? String(choice.scalePercent) : "100",
    hexColor: choice.hexColor || "#1a1a1a",
    borderThicknessPx: choice.borderThicknessPx ? String(choice.borderThicknessPx) : "24",
    matThicknessPx: choice.matThicknessPx ? String(choice.matThicknessPx) : "",
    borderRadiusPx:
      choice.borderRadiusPx !== null && choice.borderRadiusPx !== undefined
        ? String(choice.borderRadiusPx)
        : "",
  };
}

function checkedValue(event: Event): boolean {
  const target = event.currentTarget as { checked?: boolean } | null;
  return target?.checked ?? false;
}

type ChoiceFormErrors = Partial<Record<keyof ChoiceFormState, string>>;

function validateChoiceForm(
  option: OptionView,
  values: ChoiceFormState,
  otherLabels: string[],
): ChoiceFormErrors {
  const errors: ChoiceFormErrors = {};

  const label = values.label.trim();

  if (!label) {
    errors.label = "Name is required.";
  } else if (
    otherLabels.some((existing) => existing.toLowerCase() === label.toLowerCase())
  ) {
    errors.label = "A choice with this name already exists.";
  }

  // Price is always optional — a blank value just means "no charge,"
  // not a validation error — only the format is checked when
  // something was actually entered.
  if (values.priceDelta.trim() !== "") {
    const price = Number(values.priceDelta);

    if (!Number.isFinite(price)) {
      errors.priceDelta = "Enter a valid price adjustment.";
    }
  }

  if (option.axisRole === "SIZE") {
    const scale = Number(values.scalePercent);

    if (!Number.isInteger(scale) || scale < 1 || scale > 400) {
      errors.scalePercent = "Scale must be between 1 and 400%.";
    }
  }

  if (
    option.type === "COLOR_SWATCH" &&
    values.hexColor.trim() &&
    !/^#[0-9a-fA-F]{6}$/.test(values.hexColor.trim())
  ) {
    errors.hexColor = "Enter a valid hex color (e.g. #1a1a1a).";
  }

  // Frame thickness, mat gap, and corner radius are all optional on
  // the Framing axis, whether the border renders from a hex color, an
  // uploaded image, or both — blank just means "use the storefront's
  // own default look" — only the format is checked when something was
  // actually entered.
  if (option.axisRole === "FRAMING") {
    if (values.borderThicknessPx.trim()) {
      const thickness = Number(values.borderThicknessPx);

      if (!Number.isInteger(thickness) || thickness < 1) {
        errors.borderThicknessPx = "Frame thickness must be a positive whole number of pixels.";
      }
    }

    if (values.matThicknessPx.trim()) {
      const mat = Number(values.matThicknessPx);

      if (!Number.isInteger(mat) || mat < 1) {
        errors.matThicknessPx = "Mat thickness must be a positive whole number of pixels.";
      }
    }

    if (values.borderRadiusPx.trim()) {
      const radius = Number(values.borderRadiusPx);

      if (!Number.isInteger(radius) || radius < 0) {
        errors.borderRadiusPx = "Corner radius must be a non-negative whole number of pixels.";
      }
    }
  }

  return errors;
}

function ChoiceFormFields({
  option,
  values,
  errors,
  imageUrl,
  onChange,
  onFileChange,
}: {
  option: OptionView;
  values: ChoiceFormState;
  errors: ChoiceFormErrors;
  imageUrl: string | null;
  onChange: (patch: Partial<ChoiceFormState>) => void;
  onFileChange: (file: File | null) => void;
}) {
  return (
    <s-stack direction="block" gap="base">
      <s-text-field
        label="Name"
        name="label"
        value={values.label}
        onInput={(event: Event) => onChange({ label: eventValue(event) })}
        placeholder="e.g. Small, Framed - Black, Ivory"
        required
        autocomplete="off"
        error={errors.label}
      />

      <s-query-container>
        <s-grid gridTemplateColumns="@container (inline-size > 360px) 1fr 1fr, 1fr" gap="base">
          <s-number-field
            label="Price adjustment"
            name="priceDelta"
            value={values.priceDelta}
            onInput={(event: Event) => onChange({ priceDelta: eventValue(event) })}
            step={0.01}
            prefix="$"
            autocomplete="off"
            error={errors.priceDelta}
            details="Leave blank for no charge."
          />

          <s-number-field
            label="Compare-at adjustment"
            name="compareAtPriceDelta"
            value={values.compareAtPriceDelta}
            onInput={(event: Event) => onChange({ compareAtPriceDelta: eventValue(event) })}
            step={0.01}
            prefix="$"
            autocomplete="off"
          />
        </s-grid>
      </s-query-container>

      {option.axisRole === "FRAMING" ? (
        <s-checkbox
          label="Ships physically"
          name="requiresShipping"
          value="yes"
          checked={values.requiresShipping}
          onInput={(event: Event) => onChange({ requiresShipping: checkedValue(event) })}
        />
      ) : null}

      {option.axisRole === "SIZE" ? (
        <s-number-field
          label="Scale %"
          name="scalePercent"
          value={values.scalePercent}
          onInput={(event: Event) => onChange({ scalePercent: eventValue(event) })}
          min={1}
          max={400}
          step={1}
          suffix="%"
          autocomplete="off"
          error={errors.scalePercent}
          details="100% = original resolution."
        />
      ) : null}

      {option.type === "COLOR_SWATCH" ? (
        <s-color-field
          label="Color"
          name="hexColor"
          value={values.hexColor}
          onInput={(event: Event) => onChange({ hexColor: eventValue(event) })}
          error={errors.hexColor}
          details={
            option.axisRole === "FRAMING"
              ? "Leave empty for no visual frame (e.g. a \"No Frame\" choice)."
              : undefined
          }
        />
      ) : null}

      <s-stack direction="block" gap="small-200">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt="Current uploaded image"
            style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid #e1e3e5" }}
          />
        ) : null}

        <s-drop-zone
          label="Image (optional)"
          name="imageFile"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(event: Event) => {
            const target = event.currentTarget as HTMLElement & { files?: File[] };

            onFileChange(target.files?.[0] ?? null);
          }}
          onInput={(event: Event) => {
            const target = event.currentTarget as HTMLElement & { files?: File[] };

            onFileChange(target.files?.[0] ?? null);
          }}
        />
      </s-stack>

      {option.axisRole === "FRAMING" ? (
        <s-query-container>
          <s-grid gridTemplateColumns="@container (inline-size > 360px) 1fr 1fr, 1fr" gap="base">
            <s-number-field
              label="Frame thickness (px)"
              name="borderThicknessPx"
              value={values.borderThicknessPx}
              onInput={(event: Event) => onChange({ borderThicknessPx: eventValue(event) })}
              min={1}
              step={1}
              suffix="px"
              autocomplete="off"
              placeholder="26"
              error={errors.borderThicknessPx}
            />

            <s-number-field
              label="Mat thickness (px)"
              name="matThicknessPx"
              value={values.matThicknessPx}
              onInput={(event: Event) => onChange({ matThicknessPx: eventValue(event) })}
              min={1}
              step={1}
              suffix="px"
              autocomplete="off"
              placeholder="18"
              error={errors.matThicknessPx}
            />

            <s-number-field
              label="Corner radius (px)"
              name="borderRadiusPx"
              value={values.borderRadiusPx}
              onInput={(event: Event) => onChange({ borderRadiusPx: eventValue(event) })}
              min={0}
              step={1}
              suffix="px"
              autocomplete="off"
              placeholder="0"
              error={errors.borderRadiusPx}
            />
          </s-grid>
        </s-query-container>
      ) : null}
    </s-stack>
  );
}

function AddChoiceModal({
  option,
  submitting,
  resetSignal,
  existingLabels,
}: {
  option: OptionView;
  submitting: boolean;
  resetSignal: number;
  existingLabels: string[];
}) {
  const [values, setValues] = useState<ChoiceFormState>(blankChoiceValues);

  const [errors, setErrors] = useState<ChoiceFormErrors>({});

  const [file, setFile] = useState<File | null>(null);

  const dirty = values.label.trim().length > 0;

  const reset = () => {
    setValues(blankChoiceValues);
    setErrors({});
    setFile(null);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reset, [resetSignal]);

  const modalId = `add-choice-${option.id}`;

  return (
    <s-modal id={modalId} heading={`Add choice to ${option.label}`}>
      <Form
        method="post"
        encType="multipart/form-data"
        onSubmit={(event) => {
          const validationErrors = validateChoiceForm(option, values, existingLabels);

          if (Object.keys(validationErrors).length > 0) {
            event.preventDefault();
            setErrors(validationErrors);
          }
        }}
      >
        <input type="hidden" name="intent" value="addChoice" />
        <input type="hidden" name="optionId" value={option.id} />

        <s-stack direction="block" gap="base">
          <ChoiceFormFields
            option={option}
            values={values}
            errors={errors}
            imageUrl={null}
            onChange={(patch) => {
              setValues((current) => ({ ...current, ...patch }));
              setErrors((current) => {
                const next = { ...current };
                for (const key of Object.keys(patch) as Array<keyof ChoiceFormState>) {
                  delete next[key];
                }
                return next;
              });
            }}
            onFileChange={setFile}
          />

          <s-stack direction="inline" gap="base">
            <s-button type="submit" variant="primary" loading={submitting} disabled={!dirty || submitting}>
              Add choice
            </s-button>

            <s-button variant="secondary" commandFor={modalId} command="--hide" onClick={reset} disabled={submitting}>
              Cancel
            </s-button>
          </s-stack>
        </s-stack>
      </Form>
    </s-modal>
  );
}

function EditChoiceModal({
  option,
  choice,
  submitting,
  otherLabels,
}: {
  option: OptionView;
  choice: OptionChoiceView;
  submitting: boolean;
  otherLabels: string[];
}) {
  const initialValues = choiceValuesOf(choice);

  const [values, setValues] = useState<ChoiceFormState>(initialValues);

  const [errors, setErrors] = useState<ChoiceFormErrors>({});

  const [file, setFile] = useState<File | null>(null);

  const isDirty =
    JSON.stringify(values) !== JSON.stringify(initialValues) || Boolean(file);

  const modalId = `edit-choice-${choice.id}`;

  return (
    <s-modal id={modalId} heading={`Edit ${choice.label}`}>
      <Form
        method="post"
        encType="multipart/form-data"
        onSubmit={(event) => {
          const validationErrors = validateChoiceForm(option, values, otherLabels);

          if (Object.keys(validationErrors).length > 0) {
            event.preventDefault();
            setErrors(validationErrors);
            return;
          }

          setErrors({});
        }}
      >
        <input type="hidden" name="intent" value="editChoice" />
        <input type="hidden" name="optionId" value={option.id} />
        <input type="hidden" name="choiceId" value={choice.id} />
        <input type="hidden" name="existingImageAssetId" value={choice.imageAssetId ?? ""} />

        <s-stack direction="block" gap="base">
          <ChoiceFormFields
            option={option}
            values={values}
            errors={errors}
            imageUrl={choice.imageUrl}
            onChange={(patch) => {
              setValues((current) => ({ ...current, ...patch }));
              setErrors((current) => {
                const next = { ...current };
                for (const key of Object.keys(patch) as Array<keyof ChoiceFormState>) {
                  delete next[key];
                }
                return next;
              });
            }}
            onFileChange={setFile}
          />

          <s-stack direction="inline" gap="base">
            <s-button type="submit" variant="primary" loading={submitting} disabled={!isDirty || submitting}>
              Save changes
            </s-button>

            <s-button
              variant="secondary"
              commandFor={modalId}
              command="--hide"
              onClick={() => {
                setValues(initialValues);
                setErrors({});
                setFile(null);
              }}
              disabled={submitting}
            >
              Cancel
            </s-button>
          </s-stack>
        </s-stack>
      </Form>
    </s-modal>
  );
}

// --- Rows / drag-and-drop -----------------------------------------------

function dragHandleStyle(): React.CSSProperties {
  return {
    display: "grid",
    placeItems: "center",
    flex: "0 0 auto",
    width: 22,
    height: 32,
    marginTop: 2,
    padding: 0,
    border: 0,
    borderRadius: 6,
    background: "transparent",
    color: "#6d7175",
    cursor: "grab",
    touchAction: "none",
  };
}

function DragDots() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "block",
        width: 14,
        height: 20,
        backgroundImage:
          "radial-gradient(circle, currentColor 1.4px, transparent 1.6px)",
        backgroundPosition: "1px 1px",
        backgroundSize: "6px 6px",
        opacity: 0.7,
      }}
    />
  );
}

function SortableChoiceRow({
  option,
  choice,
  index,
  editable,
}: {
  option: OptionView;
  choice: OptionChoiceView;
  index: number;
  editable: boolean;
}) {
  const { ref, handleRef, isDragging, isDropTarget } = useSortable({
    id: choice.id,
    index,
    group: `choices-${option.id}`,
    disabled: !editable,
    transition: { duration: 180, easing: "cubic-bezier(0.25, 1, 0.5, 1)", idle: true },
  });

  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: 10,
        border: "1px solid",
        borderColor: isDropTarget ? "#005bd3" : "#e1e3e5",
        borderRadius: 8,
        background: isDropTarget ? "#f4f8ff" : "#fbfbfb",
        opacity: isDragging ? 0.6 : 1,
        boxShadow: isDragging ? "0 10px 24px rgba(0, 0, 0, 0.14)" : undefined,
        zIndex: isDragging ? 20 : undefined,
        transition: "border-color 140ms ease, background 140ms ease",
      }}
    >
      {editable ? (
        <button ref={handleRef} type="button" aria-label={`Drag ${choice.label} to reorder`} title="Drag to reorder" style={dragHandleStyle()}>
          <DragDots />
        </button>
      ) : null}

      <div style={{ flex: 1, minWidth: 0 }}>
        <s-stack direction="inline" gap="base" alignItems="start" justifyContent="space-between">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            {option.type === "COLOR_SWATCH" && choice.hexColor ? (
              <div
                aria-hidden="true"
                style={{ width: 16, height: 16, borderRadius: "50%", background: choice.hexColor, border: "1px solid rgba(0,0,0,0.15)", flex: "0 0 auto" }}
              />
            ) : null}

            {choice.imageUrl ? (
              <img
                src={choice.imageUrl}
                alt=""
                style={{ width: 20, height: 20, objectFit: "cover", borderRadius: 4, flex: "0 0 auto" }}
              />
            ) : null}

            <s-text type="strong">{choice.label}</s-text>

            {choice.priceDelta !== "" ? (
              <s-badge tone="neutral">
                {Number(choice.priceDelta) >= 0 ? "+" : ""}${choice.priceDelta}
              </s-badge>
            ) : null}

            {option.axisRole === "SIZE" ? <s-badge tone="info">{choice.scalePercent}% scale</s-badge> : null}

            {option.axisRole === "FRAMING" ? (
              choice.requiresShipping ? (
                <s-badge tone="warning">Ships physically</s-badge>
              ) : (
                <s-badge tone="success">Digital</s-badge>
              )
            ) : null}
          </s-stack>

          {editable ? (
            <s-stack direction="inline" gap="small">
              <s-button variant="tertiary" commandFor={`edit-choice-${choice.id}`} command="--show">
                Edit
              </s-button>

              <s-button
                icon="delete"
                variant="tertiary"
                tone="critical"
                commandFor={`delete-choice-${choice.id}`}
                command="--show"
                accessibilityLabel={`Delete ${choice.label}`}
              />
            </s-stack>
          ) : null}
        </s-stack>
      </div>
    </div>
  );
}

function OptionChoices({ option, editable }: { option: OptionView; editable: boolean }) {
  const navigation = useNavigation();

  const submitting = navigation.state !== "idle" && Boolean(navigation.formData);

  const submittingIntent = submitting ? navigation.formData?.get("intent") : null;

  const submittingChoiceId = submitting ? navigation.formData?.get("choiceId") : null;

  const [addModalResetKey, setAddModalResetKey] = useState(0);

  const submit = useSubmit();

  const [orderedChoices, setOrderedChoices] = useState(option.choices);

  useEffect(() => {
    setOrderedChoices(option.choices);
  }, [option.choices]);

  const submitReorder = (nextChoices: OptionChoiceView[]) => {
    const formData = new FormData();
    formData.set("intent", "reorderChoices");
    formData.set("optionId", option.id);
    for (const choice of nextChoices) {
      formData.append("choiceId", choice.id);
    }
    submit(formData, { method: "post" });
  };

  return (
    <s-stack direction="block" gap="small-200">
      {option.choices.length === 0 ? (
        <s-text color="subdued">No choices yet.</s-text>
      ) : (
        <DragDropProvider
          onDragEnd={(event) => {
            if (event.canceled || !editable) return;

            const reordered = move(orderedChoices, event);

            const orderChanged = reordered.some((choice, index) => choice.id !== orderedChoices[index]?.id);

            if (!orderChanged) return;

            setOrderedChoices(reordered);
            submitReorder(reordered);
          }}
        >
          <s-stack direction="block" gap="small-200">
            {orderedChoices.map((choice, index) => (
              <SortableChoiceRow key={choice.id} option={option} choice={choice} index={index} editable={editable} />
            ))}
          </s-stack>
        </DragDropProvider>
      )}

      {editable ? (
        <s-stack direction="inline" gap="base">
          <s-button
            icon="plus"
            variant="tertiary"
            commandFor={`add-choice-${option.id}`}
            command="--show"
            onClick={() => setAddModalResetKey((key) => key + 1)}
          >
            Add choice
          </s-button>
        </s-stack>
      ) : null}

      {editable ? (
        <AddChoiceModal
          option={option}
          submitting={submittingIntent === "addChoice"}
          resetSignal={addModalResetKey}
          existingLabels={option.choices.map((choice) => choice.label)}
        />
      ) : null}

      {editable
        ? option.choices.map((choice) => (
            <EditChoiceModal
              key={`edit-${choice.id}`}
              option={option}
              choice={choice}
              submitting={submittingIntent === "editChoice" && submittingChoiceId === choice.id}
              otherLabels={option.choices.filter((other) => other.id !== choice.id).map((other) => other.label)}
            />
          ))
        : null}

      {editable
        ? option.choices.map((choice) => (
            <s-modal key={`delete-${choice.id}`} id={`delete-choice-${choice.id}`} heading="Delete choice?">
              <Form method="post">
                <input type="hidden" name="intent" value="deleteChoice" />
                <input type="hidden" name="optionId" value={option.id} />
                <input type="hidden" name="choiceId" value={choice.id} />

                <s-stack direction="block" gap="base">
                  <s-paragraph>
                    Delete "{choice.label}"? This choice will no longer be offered to customers.
                  </s-paragraph>

                  <s-stack direction="inline" gap="base">
                    <s-button
                      variant="secondary"
                      commandFor={`delete-choice-${choice.id}`}
                      command="--hide"
                      disabled={submittingIntent === "deleteChoice" && submittingChoiceId === choice.id}
                    >
                      Cancel
                    </s-button>

                    <s-button
                      type="submit"
                      variant="primary"
                      tone="critical"
                      loading={submittingIntent === "deleteChoice" && submittingChoiceId === choice.id}
                      disabled={submittingIntent === "deleteChoice" && submittingChoiceId === choice.id}
                    >
                      Delete choice
                    </s-button>
                  </s-stack>
                </s-stack>
              </Form>
            </s-modal>
          ))
        : null}
    </s-stack>
  );
}

function SortableOptionRow({
  option,
  index,
  editable,
  otherLabels,
  takenAxisRoles,
  submittingIntent,
  submittingOptionId,
}: {
  option: OptionView;
  index: number;
  editable: boolean;
  otherLabels: string[];
  takenAxisRoles: Set<string>;
  submittingIntent: FormDataEntryValue | null;
  submittingOptionId: FormDataEntryValue | null;
}) {
  const { ref, handleRef, isDragging, isDropTarget } = useSortable({
    id: option.id,
    index,
    group: "options",
    disabled: !editable,
    transition: { duration: 180, easing: "cubic-bezier(0.25, 1, 0.5, 1)", idle: true },
  });

  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: 14,
        border: "1px solid",
        borderColor: isDropTarget ? "#005bd3" : "#e1e3e5",
        borderRadius: 10,
        background: isDropTarget ? "#f4f8ff" : "#ffffff",
        opacity: isDragging ? 0.6 : 1,
        boxShadow: isDragging ? "0 10px 24px rgba(0, 0, 0, 0.14)" : undefined,
        zIndex: isDragging ? 20 : undefined,
        transition: "border-color 140ms ease, background 140ms ease",
      }}
    >
      {editable ? (
        <button ref={handleRef} type="button" aria-label={`Drag ${option.label} to reorder`} title="Drag to reorder" style={dragHandleStyle()}>
          <DragDots />
        </button>
      ) : null}

      <div style={{ flex: 1, minWidth: 0 }}>
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" alignItems="start" justifyContent="space-between">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text type="strong">{option.label}</s-text>
              <s-badge tone="neutral">{typeLabel(option.type)}</s-badge>
              {axisRoleLabel(option.axisRole) ? <s-badge tone="success">{axisRoleLabel(option.axisRole)}</s-badge> : null}
            </s-stack>

            {editable ? (
              <s-stack direction="inline" gap="small">
                <s-button variant="tertiary" commandFor={`edit-option-${option.id}`} command="--show">
                  Edit
                </s-button>

                <s-button
                  icon="delete"
                  variant="tertiary"
                  tone="critical"
                  commandFor={`delete-option-${option.id}`}
                  command="--show"
                  accessibilityLabel={`Delete ${option.label}`}
                />
              </s-stack>
            ) : null}
          </s-stack>

          <OptionChoices option={option} editable={editable} />
        </s-stack>
      </div>

      {editable ? (
        <EditOptionModal
          option={option}
          submitting={submittingIntent === "editOption" && submittingOptionId === option.id}
          otherLabels={otherLabels}
          takenAxisRoles={takenAxisRoles}
        />
      ) : null}

      {editable ? (
        <s-modal id={`delete-option-${option.id}`} heading="Delete option?">
          <Form method="post">
            <input type="hidden" name="intent" value="deleteOption" />
            <input type="hidden" name="optionId" value={option.id} />

            <s-stack direction="block" gap="base">
              <s-paragraph>
                Delete "{option.label}"? Its {option.choices.length} choice
                {option.choices.length === 1 ? "" : "s"} will no longer be offered to customers.
              </s-paragraph>

              <s-stack direction="inline" gap="base">
                <s-button
                  variant="secondary"
                  commandFor={`delete-option-${option.id}`}
                  command="--hide"
                  disabled={submittingIntent === "deleteOption" && submittingOptionId === option.id}
                >
                  Cancel
                </s-button>

                <s-button
                  type="submit"
                  variant="primary"
                  tone="critical"
                  loading={submittingIntent === "deleteOption" && submittingOptionId === option.id}
                  disabled={submittingIntent === "deleteOption" && submittingOptionId === option.id}
                >
                  Delete option
                </s-button>
              </s-stack>
            </s-stack>
          </Form>
        </s-modal>
      ) : null}
    </div>
  );
}

export function StyleOptionsEditor({ options, editable }: { options: OptionView[]; editable: boolean }) {
  const navigation = useNavigation();

  const submitting = navigation.state !== "idle" && Boolean(navigation.formData);

  const submittingIntent = submitting ? (navigation.formData?.get("intent") ?? null) : null;

  const submittingOptionId = submitting ? (navigation.formData?.get("optionId") ?? null) : null;

  const [addModalResetKey, setAddModalResetKey] = useState(0);

  const submit = useSubmit();

  const [orderedOptions, setOrderedOptions] = useState(options);

  useEffect(() => {
    setOrderedOptions(options);
  }, [options]);

  const submitReorder = (nextOptions: OptionView[]) => {
    const formData = new FormData();
    formData.set("intent", "reorderOptions");
    for (const option of nextOptions) {
      formData.append("optionId", option.id);
    }
    submit(formData, { method: "post" });
  };

  const takenAxisRoles = new Set(
    options.map((option) => option.axisRole).filter((role): role is string => Boolean(role)),
  );

  return (
    <s-section heading="Product options">
      <s-stack direction="block" gap="base">
        {options.length === 0 ? (
          <s-text color="subdued">
            No options yet — this publishes as a single, one-size product until you add some.
          </s-text>
        ) : (
          <DragDropProvider
            onDragEnd={(event) => {
              if (event.canceled || !editable) return;

              const reordered = move(orderedOptions, event);

              const orderChanged = reordered.some((option, index) => option.id !== orderedOptions[index]?.id);

              if (!orderChanged) return;

              setOrderedOptions(reordered);
              submitReorder(reordered);
            }}
          >
            <s-stack direction="block" gap="base">
              {orderedOptions.map((option, index) => (
                <SortableOptionRow
                  key={option.id}
                  option={option}
                  index={index}
                  editable={editable}
                  otherLabels={options.filter((other) => other.id !== option.id).map((other) => other.label)}
                  takenAxisRoles={takenAxisRoles}
                  submittingIntent={submittingIntent}
                  submittingOptionId={submittingOptionId}
                />
              ))}
            </s-stack>
          </DragDropProvider>
        )}

        {editable ? (
          <s-stack direction="inline" gap="base">
            <s-button
              icon="plus"
              variant="secondary"
              commandFor="add-option"
              command="--show"
              onClick={() => setAddModalResetKey((key) => key + 1)}
            >
              Add option
            </s-button>
          </s-stack>
        ) : null}
      </s-stack>

      {editable ? (
        <AddOptionModal
          submitting={submittingIntent === "addOption"}
          resetSignal={addModalResetKey}
          existingLabels={options.map((option) => option.label)}
          takenAxisRoles={takenAxisRoles}
        />
      ) : null}
    </s-section>
  );
}
