import { useState } from "react";
import { Form, useNavigation } from "react-router";

import { eventValue } from "../../utils/event-value";

export type FramingOptionView = {
  id: string;
  label: string;
  priceDelta: string;
  compareAtPriceDelta: string;
  requiresShipping: boolean;
};

type FramingFormState = {
  label: string;
  priceDelta: string;
  compareAtPriceDelta: string;
  requiresShipping: boolean;
};

const blankFramingValues: FramingFormState = {
  label: "",
  priceDelta: "0",
  compareAtPriceDelta: "",
  requiresShipping: true,
};

function framingValuesOf(option: FramingOptionView): FramingFormState {
  return {
    label: option.label,
    priceDelta: option.priceDelta,
    compareAtPriceDelta: option.compareAtPriceDelta,
    requiresShipping: option.requiresShipping,
  };
}

function checkedValue(event: Event): boolean {
  const target = event.currentTarget as { checked?: boolean } | null;

  return target?.checked ?? false;
}

function FramingFormFields({
  values,
  onChange,
}: {
  values: FramingFormState;
  onChange: (patch: Partial<FramingFormState>) => void;
}) {
  return (
    <s-stack direction="block" gap="base">
      <s-text-field
        label="Name"
        name="label"
        value={values.label}
        onInput={(event: Event) => onChange({ label: eventValue(event) })}
        placeholder="e.g. Framed - Black"
        required
        autocomplete="off"
      />

      <s-query-container>
        <s-grid
          gridTemplateColumns="@container (inline-size > 360px) 1fr 1fr, 1fr"
          gap="base"
        >
          <s-number-field
            label="Price adjustment"
            name="priceDelta"
            value={values.priceDelta}
            onInput={(event: Event) =>
              onChange({ priceDelta: eventValue(event) })
            }
            step={0.01}
            prefix="$"
            autocomplete="off"
          />

          <s-number-field
            label="Compare-at adjustment"
            name="compareAtPriceDelta"
            value={values.compareAtPriceDelta}
            onInput={(event: Event) =>
              onChange({ compareAtPriceDelta: eventValue(event) })
            }
            step={0.01}
            prefix="$"
            autocomplete="off"
          />
        </s-grid>
      </s-query-container>

      <s-checkbox
        label="Ships physically"
        name="requiresShipping"
        value="yes"
        checked={values.requiresShipping}
        onInput={(event: Event) =>
          onChange({ requiresShipping: checkedValue(event) })
        }
        details="Turn on for a real framed product; leave off for an unframed/digital choice."
      />
    </s-stack>
  );
}

function AddFramingModal({
  submitting,
  onAdded,
}: {
  submitting: boolean;
  onAdded: () => void;
}) {
  const [values, setValues] = useState<FramingFormState>(blankFramingValues);

  const dirty = values.label.trim().length > 0;

  const reset = () => setValues(blankFramingValues);

  return (
    <s-modal id="add-framing" heading="Add framing option">
      <Form
        method="post"
        onSubmit={() => {
          reset();
          onAdded();
        }}
      >
        <input type="hidden" name="intent" value="addFraming" />

        <s-stack direction="block" gap="base">
          <FramingFormFields
            values={values}
            onChange={(patch) =>
              setValues((current) => ({ ...current, ...patch }))
            }
          />

          <s-stack direction="inline" gap="base">
            <s-button
              type="submit"
              variant="primary"
              loading={submitting}
              disabled={!dirty || submitting}
            >
              Add framing option
            </s-button>

            <s-button
              variant="secondary"
              commandFor="add-framing"
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

function EditFramingModal({
  option,
  submitting,
}: {
  option: FramingOptionView;
  submitting: boolean;
}) {
  const initialValues = framingValuesOf(option);

  const [values, setValues] = useState<FramingFormState>(initialValues);

  const isDirty =
    values.label !== initialValues.label ||
    values.priceDelta !== initialValues.priceDelta ||
    values.compareAtPriceDelta !== initialValues.compareAtPriceDelta ||
    values.requiresShipping !== initialValues.requiresShipping;

  return (
    <s-modal
      id={`edit-framing-${option.id}`}
      heading={`Edit ${option.label}`}
    >
      <Form method="post">
        <input type="hidden" name="intent" value="editFraming" />

        <input type="hidden" name="framingOptionId" value={option.id} />

        <s-stack direction="block" gap="base">
          <FramingFormFields
            values={values}
            onChange={(patch) =>
              setValues((current) => ({ ...current, ...patch }))
            }
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
              commandFor={`edit-framing-${option.id}`}
              command="--hide"
              onClick={() => setValues(initialValues)}
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

function FramingRow({
  option,
  editable,
}: {
  option: FramingOptionView;
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
          <s-badge tone="neutral">
            {Number(option.priceDelta) >= 0 ? "+" : ""}
            ${option.priceDelta}
          </s-badge>

          {option.requiresShipping ? (
            <s-badge tone="warning">Ships physically</s-badge>
          ) : (
            <s-badge tone="success">Digital</s-badge>
          )}
        </s-stack>
      </s-stack>

      {editable ? (
        <s-stack direction="inline" gap="small">
          <s-button
            variant="tertiary"
            commandFor={`edit-framing-${option.id}`}
            command="--show"
          >
            Edit
          </s-button>

          <s-button
            icon="delete"
            variant="tertiary"
            tone="critical"
            commandFor={`delete-framing-${option.id}`}
            command="--show"
            accessibilityLabel={`Delete ${option.label}`}
          />
        </s-stack>
      ) : null}
    </div>
  );
}

export function FramingOptionsEditor({
  framingOptions,
  editable,
}: {
  framingOptions: FramingOptionView[];
  editable: boolean;
}) {
  const navigation = useNavigation();

  const submitting =
    navigation.state !== "idle" && Boolean(navigation.formData);

  const submittingIntent = submitting
    ? navigation.formData?.get("intent")
    : null;

  const submittingFramingOptionId = submitting
    ? navigation.formData?.get("framingOptionId")
    : null;

  return (
    <s-section heading="Framing">
      <s-stack direction="block" gap="base">
        {framingOptions.length === 0 ? (
          <s-text color="subdued">
            No framing options yet — sizes (if any) publish on their own.
          </s-text>
        ) : (
          <s-stack direction="block" gap="small-200">
            {framingOptions.map((option) => (
              <FramingRow
                key={option.id}
                option={option}
                editable={editable}
              />
            ))}
          </s-stack>
        )}

        {editable ? (
          <s-stack direction="inline" gap="base">
            <s-button
              icon="plus"
              variant="secondary"
              commandFor="add-framing"
              command="--show"
            >
              Add framing option
            </s-button>
          </s-stack>
        ) : null}
      </s-stack>

      {editable ? (
        <AddFramingModal
          submitting={submittingIntent === "addFraming"}
          onAdded={() => {}}
        />
      ) : null}

      {editable
        ? framingOptions.map((option) => (
            <EditFramingModal
              key={`edit-${option.id}`}
              option={option}
              submitting={
                submittingIntent === "editFraming" &&
                submittingFramingOptionId === option.id
              }
            />
          ))
        : null}

      {editable
        ? framingOptions.map((option) => (
            <s-modal
              key={`delete-${option.id}`}
              id={`delete-framing-${option.id}`}
              heading="Delete framing option?"
            >
              <Form method="post">
                <input type="hidden" name="intent" value="deleteFraming" />

                <input
                  type="hidden"
                  name="framingOptionId"
                  value={option.id}
                />

                <s-stack direction="block" gap="base">
                  <s-paragraph>
                    Delete “{option.label}”? This framing option will no
                    longer be offered to customers.
                  </s-paragraph>

                  <s-stack direction="inline" gap="base">
                    <s-button
                      variant="secondary"
                      commandFor={`delete-framing-${option.id}`}
                      command="--hide"
                      disabled={
                        submittingIntent === "deleteFraming" &&
                        submittingFramingOptionId === option.id
                      }
                    >
                      Cancel
                    </s-button>

                    <s-button
                      type="submit"
                      variant="primary"
                      tone="critical"
                      loading={
                        submittingIntent === "deleteFraming" &&
                        submittingFramingOptionId === option.id
                      }
                      disabled={
                        submittingIntent === "deleteFraming" &&
                        submittingFramingOptionId === option.id
                      }
                    >
                      Delete framing option
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
