import { useState } from "react";
import { Form, useNavigation } from "react-router";

import { eventValue } from "../../utils/event-value";

export type SizeOptionView = {
  id: string;
  label: string;
  scalePercent: number;
  price: string;
  compareAtPrice: string;
};

type SizeFormState = {
  label: string;
  scalePercent: string;
  price: string;
  compareAtPrice: string;
};

const blankSizeValues: SizeFormState = {
  label: "",
  scalePercent: "100",
  price: "",
  compareAtPrice: "",
};

function sizeValuesOf(option: SizeOptionView): SizeFormState {
  return {
    label: option.label,
    scalePercent: String(option.scalePercent),
    price: option.price,
    compareAtPrice: option.compareAtPrice,
  };
}

type SizeFormErrors = Partial<Record<keyof SizeFormState, string>>;

function validateSizeForm(values: SizeFormState): SizeFormErrors {
  const errors: SizeFormErrors = {};

  if (!values.label.trim()) {
    errors.label = "Name is required.";
  }

  const price = Number(values.price);

  if (!values.price.trim() || !Number.isFinite(price) || price <= 0) {
    errors.price = "Price must be greater than $0.";
  }

  if (values.compareAtPrice.trim()) {
    const compareAtPrice = Number(values.compareAtPrice);

    if (Number.isFinite(compareAtPrice) && compareAtPrice <= price) {
      errors.compareAtPrice =
        "Compare-at price must be greater than the price.";
    }
  }

  return errors;
}

function SizeFormFields({
  values,
  errors,
  onChange,
}: {
  values: SizeFormState;
  errors: SizeFormErrors;
  onChange: (patch: Partial<SizeFormState>) => void;
}) {
  return (
    <s-stack direction="block" gap="base">
      <s-text-field
        label="Name"
        name="label"
        value={values.label}
        onInput={(event: Event) => onChange({ label: eventValue(event) })}
        placeholder="e.g. Medium"
        required
        autocomplete="off"
        error={errors.label}
      />

      <s-number-field
        label="Scale %"
        name="scalePercent"
        value={values.scalePercent}
        onInput={(event: Event) =>
          onChange({ scalePercent: eventValue(event) })
        }
        min={1}
        max={100}
        step={1}
        suffix="%"
        autocomplete="off"
        details="A rough guide: 100% ≈ Large, 80% ≈ Medium, 60% ≈ Small — just informative, use whatever fits your sizes."
      />

      <s-query-container>
        <s-grid
          gridTemplateColumns="@container (inline-size > 360px) 1fr 1fr, 1fr"
          gap="base"
        >
          <s-number-field
            label="Price"
            name="price"
            value={values.price}
            onInput={(event: Event) => onChange({ price: eventValue(event) })}
            min={0}
            step={0.01}
            prefix="$"
            autocomplete="off"
            error={errors.price}
          />

          <s-number-field
            label="Compare-at price"
            name="compareAtPrice"
            value={values.compareAtPrice}
            onInput={(event: Event) =>
              onChange({ compareAtPrice: eventValue(event) })
            }
            min={0}
            step={0.01}
            prefix="$"
            autocomplete="off"
            details="Optional. Shown crossed out next to the price."
            error={errors.compareAtPrice}
          />
        </s-grid>
      </s-query-container>
    </s-stack>
  );
}

function AddSizeModal({
  submitting,
  onAdded,
}: {
  submitting: boolean;
  onAdded: () => void;
}) {
  const [values, setValues] = useState<SizeFormState>(blankSizeValues);

  const [errors, setErrors] = useState<SizeFormErrors>({});

  const dirty = values.label.trim().length > 0;

  const reset = () => {
    setValues(blankSizeValues);
    setErrors({});
  };

  return (
    <s-modal id="add-size" heading="Add size">
      <Form
        method="post"
        onSubmit={(event) => {
          const validationErrors = validateSizeForm(values);

          if (Object.keys(validationErrors).length > 0) {
            event.preventDefault();
            setErrors(validationErrors);
            return;
          }

          reset();
          onAdded();
        }}
      >
        <input type="hidden" name="intent" value="addSize" />

        <s-stack direction="block" gap="base">
          <SizeFormFields
            values={values}
            errors={errors}
            onChange={(patch) => {
              setValues((current) => ({ ...current, ...patch }));
              setErrors((current) => {
                const next = { ...current };

                for (const key of Object.keys(patch) as Array<
                  keyof SizeFormState
                >) {
                  delete next[key];
                }

                return next;
              });
            }}
          />

          <s-stack direction="inline" gap="base">
            <s-button
              type="submit"
              variant="primary"
              loading={submitting}
              disabled={!dirty || submitting}
            >
              Add size
            </s-button>

            <s-button
              variant="secondary"
              commandFor="add-size"
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

function EditSizeModal({
  option,
  submitting,
}: {
  option: SizeOptionView;
  submitting: boolean;
}) {
  const initialValues = sizeValuesOf(option);

  const [values, setValues] = useState<SizeFormState>(initialValues);

  const [errors, setErrors] = useState<SizeFormErrors>({});

  const isDirty =
    values.label !== initialValues.label ||
    values.scalePercent !== initialValues.scalePercent ||
    values.price !== initialValues.price ||
    values.compareAtPrice !== initialValues.compareAtPrice;

  return (
    <s-modal id={`edit-size-${option.id}`} heading={`Edit ${option.label}`}>
      <Form
        method="post"
        onSubmit={(event) => {
          const validationErrors = validateSizeForm(values);

          if (Object.keys(validationErrors).length > 0) {
            event.preventDefault();
            setErrors(validationErrors);
            return;
          }

          setErrors({});
        }}
      >
        <input type="hidden" name="intent" value="editSize" />

        <input type="hidden" name="sizeOptionId" value={option.id} />

        <s-stack direction="block" gap="base">
          <SizeFormFields
            values={values}
            errors={errors}
            onChange={(patch) => {
              setValues((current) => ({ ...current, ...patch }));
              setErrors((current) => {
                const next = { ...current };

                for (const key of Object.keys(patch) as Array<
                  keyof SizeFormState
                >) {
                  delete next[key];
                }

                return next;
              });
            }}
          />

          <s-stack direction="inline" gap="base">
            <s-button
              type="submit"
              variant="primary"
              loading={submitting}
              disabled={!isDirty || submitting}
            >
              Save changes
            </s-button>

            <s-button
              variant="secondary"
              commandFor={`edit-size-${option.id}`}
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

function SizeRow({
  option,
  editable,
}: {
  option: SizeOptionView;
  editable: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "10px",
        padding: "12px",
        border: "1px solid #e1e3e5",
        borderRadius: "8px",
        background: "#ffffff",
      }}
    >
      <s-stack direction="block" gap="small-200">
        <s-text type="strong">{option.label}</s-text>

        <s-stack direction="inline" gap="small">
          <s-badge tone="info">{option.scalePercent}% scale</s-badge>

          <s-badge tone="neutral">${option.price}</s-badge>

          {option.compareAtPrice ? (
            <s-badge tone="neutral">was ${option.compareAtPrice}</s-badge>
          ) : null}
        </s-stack>
      </s-stack>

      {editable ? (
        <s-stack direction="inline" gap="small">
          <s-button
            variant="tertiary"
            commandFor={`edit-size-${option.id}`}
            command="--show"
          >
            Edit
          </s-button>

          <s-button
            icon="delete"
            variant="tertiary"
            tone="critical"
            commandFor={`delete-size-${option.id}`}
            command="--show"
            accessibilityLabel={`Delete ${option.label}`}
          />
        </s-stack>
      ) : null}
    </div>
  );
}

export function SizeOptionsEditor({
  sizeOptions,
  editable,
}: {
  sizeOptions: SizeOptionView[];
  editable: boolean;
}) {
  const navigation = useNavigation();

  const submitting =
    navigation.state !== "idle" && Boolean(navigation.formData);

  const submittingIntent = submitting
    ? navigation.formData?.get("intent")
    : null;

  const submittingSizeOptionId = submitting
    ? navigation.formData?.get("sizeOptionId")
    : null;

  return (
    <s-section heading="Sizes">
      <s-stack direction="block" gap="base">
        {sizeOptions.length === 0 ? (
          <s-text color="subdued">
            No sizes yet — this publishes as a single, one-size product.
          </s-text>
        ) : (
          <s-stack direction="block" gap="small-200">
            {sizeOptions.map((option) => (
              <SizeRow key={option.id} option={option} editable={editable} />
            ))}
          </s-stack>
        )}

        {editable ? (
          <s-stack direction="inline" gap="base">
            <s-button
              icon="plus"
              variant="secondary"
              commandFor="add-size"
              command="--show"
            >
              Add size
            </s-button>
          </s-stack>
        ) : null}
      </s-stack>

      {editable ? (
        <AddSizeModal
          submitting={submittingIntent === "addSize"}
          onAdded={() => {}}
        />
      ) : null}

      {editable
        ? sizeOptions.map((option) => (
            <EditSizeModal
              key={`edit-${option.id}`}
              option={option}
              submitting={
                submittingIntent === "editSize" &&
                submittingSizeOptionId === option.id
              }
            />
          ))
        : null}

      {editable
        ? sizeOptions.map((option) => (
            <s-modal
              key={`delete-${option.id}`}
              id={`delete-size-${option.id}`}
              heading="Delete size?"
            >
              <Form method="post">
                <input type="hidden" name="intent" value="deleteSize" />

                <input type="hidden" name="sizeOptionId" value={option.id} />

                <s-stack direction="block" gap="base">
                  <s-paragraph>
                    Delete “{option.label}”? This size will no longer be
                    offered to customers.
                  </s-paragraph>

                  <s-stack direction="inline" gap="base">
                    <s-button
                      variant="secondary"
                      commandFor={`delete-size-${option.id}`}
                      command="--hide"
                      disabled={
                        submittingIntent === "deleteSize" &&
                        submittingSizeOptionId === option.id
                      }
                    >
                      Cancel
                    </s-button>

                    <s-button
                      type="submit"
                      variant="primary"
                      tone="critical"
                      loading={
                        submittingIntent === "deleteSize" &&
                        submittingSizeOptionId === option.id
                      }
                      disabled={
                        submittingIntent === "deleteSize" &&
                        submittingSizeOptionId === option.id
                      }
                    >
                      Delete size
                    </s-button>
                  </s-stack>
                </s-stack>
              </Form>
            </s-modal>
          ))
        : null}
    </s-section>
  );
}
