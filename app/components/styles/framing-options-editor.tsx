import { useEffect, useState } from "react";
import { move } from "@dnd-kit/helpers";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { Form, useNavigation, useSubmit } from "react-router";

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

type FramingFormErrors = Partial<Record<keyof FramingFormState, string>>;

function validateFramingForm(values: FramingFormState): FramingFormErrors {
  const errors: FramingFormErrors = {};

  if (!values.label.trim()) {
    errors.label = "Name is required.";
  }

  return errors;
}

function FramingFormFields({
  values,
  errors,
  onChange,
}: {
  values: FramingFormState;
  errors: FramingFormErrors;
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
        error={errors.label}
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
  resetSignal,
}: {
  submitting: boolean;
  resetSignal: number;
}) {
  const [values, setValues] = useState<FramingFormState>(blankFramingValues);

  const [errors, setErrors] = useState<FramingFormErrors>({});

  const dirty = values.label.trim().length > 0;

  // Resets in place, not via remounting — see the identical comment in
  // size-options-editor.tsx's AddSizeModal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setValues(blankFramingValues);
    setErrors({});
  }, [resetSignal]);

  return (
    <s-modal id="add-framing" heading="Add framing option">
      <Form
        method="post"
        onSubmit={(event) => {
          const validationErrors = validateFramingForm(values);

          if (Object.keys(validationErrors).length > 0) {
            event.preventDefault();
            setErrors(validationErrors);
          }

          // Do NOT reset values here — see AddSizeModal's identical
          // comment. The trigger button resets it instead, right
          // before a fresh modal opens.
        }}
      >
        <input type="hidden" name="intent" value="addFraming" />

        <s-stack direction="block" gap="base">
          <FramingFormFields
            values={values}
            errors={errors}
            onChange={(patch) => {
              setValues((current) => ({ ...current, ...patch }));
              setErrors((current) => {
                const next = { ...current };

                for (const key of Object.keys(patch) as Array<
                  keyof FramingFormState
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
              Add framing option
            </s-button>

            <s-button
              variant="secondary"
              commandFor="add-framing"
              command="--hide"
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

  const [errors, setErrors] = useState<FramingFormErrors>({});

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
      <Form
        method="post"
        onSubmit={(event) => {
          const validationErrors = validateFramingForm(values);

          if (Object.keys(validationErrors).length > 0) {
            event.preventDefault();
            setErrors(validationErrors);
            return;
          }

          setErrors({});
        }}
      >
        <input type="hidden" name="intent" value="editFraming" />

        <input type="hidden" name="framingOptionId" value={option.id} />

        <s-stack direction="block" gap="base">
          <FramingFormFields
            values={values}
            errors={errors}
            onChange={(patch) => {
              setValues((current) => ({ ...current, ...patch }));
              setErrors((current) => {
                const next = { ...current };

                for (const key of Object.keys(patch) as Array<
                  keyof FramingFormState
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
              commandFor={`edit-framing-${option.id}`}
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

// Draggable row using @dnd-kit — same library/pattern as this app's
// Customer fields tab (see SortableFieldRow in customer-fields.tsx).
function SortableFramingRow({
  option,
  index,
  editable,
}: {
  option: FramingOptionView;
  index: number;
  editable: boolean;
}) {
  const { ref, handleRef, isDragging, isDropTarget } = useSortable({
    id: option.id,
    index,
    group: "framing-options",
    disabled: !editable,

    transition: {
      duration: 180,
      easing: "cubic-bezier(0.25, 1, 0.5, 1)",
      idle: true,
    },
  });

  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        padding: "12px",
        border: "1px solid",
        borderColor: isDropTarget ? "#005bd3" : "#e1e3e5",
        borderRadius: "8px",
        background: isDropTarget ? "#f4f8ff" : "#ffffff",
        opacity: isDragging ? 0.6 : 1,
        boxShadow: isDragging ? "0 10px 24px rgba(0, 0, 0, 0.14)" : undefined,
        zIndex: isDragging ? 20 : undefined,
        transition: "border-color 140ms ease, background 140ms ease",
      }}
    >
      {editable ? (
        <button
          ref={handleRef}
          type="button"
          aria-label={`Drag ${option.label} to reorder`}
          title="Drag to reorder"
          style={{
            display: "grid",
            placeItems: "center",
            flex: "0 0 auto",
            width: "22px",
            height: "32px",
            marginTop: "2px",
            padding: 0,
            border: 0,
            borderRadius: "6px",
            background: "transparent",
            color: "#6d7175",
            cursor: "grab",
            touchAction: "none",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: "block",
              width: "14px",
              height: "20px",
              backgroundImage:
                "radial-gradient(circle, currentColor 1.4px, transparent 1.6px)",
              backgroundPosition: "1px 1px",
              backgroundSize: "6px 6px",
              opacity: 0.7,
            }}
          />
        </button>
      ) : null}

      <div style={{ flex: 1, minWidth: 0 }}>
        <s-stack
          direction="inline"
          gap="base"
          alignItems="start"
          justifyContent="space-between"
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
        </s-stack>
      </div>
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

  // Triggers AddFramingModal's own reset effect (see its resetSignal
  // prop) right before a fresh modal opens — see the identical comment
  // in size-options-editor.tsx's SizeOptionsEditor.
  const [addModalResetKey, setAddModalResetKey] = useState(0);

  const submit = useSubmit();

  // Local, reorderable copy — same pattern as SizeOptionsEditor /
  // CustomerFields' orderedFields.
  const [orderedFramingOptions, setOrderedFramingOptions] =
    useState(framingOptions);

  useEffect(() => {
    setOrderedFramingOptions(framingOptions);
  }, [framingOptions]);

  const submitReorder = (nextOptions: FramingOptionView[]) => {
    const formData = new FormData();

    formData.set("intent", "reorderFraming");

    for (const option of nextOptions) {
      formData.append("framingOptionId", option.id);
    }

    submit(formData, { method: "post" });
  };

  return (
    <s-section heading="Framing">
      <s-stack direction="block" gap="base">
        {framingOptions.length === 0 ? (
          <s-text color="subdued">
            No framing options yet — sizes (if any) publish on their own.
          </s-text>
        ) : (
          <DragDropProvider
            onDragEnd={(event) => {
              if (event.canceled || !editable) {
                return;
              }

              const reordered = move(orderedFramingOptions, event);

              const orderChanged = reordered.some(
                (option, index) =>
                  option.id !== orderedFramingOptions[index]?.id,
              );

              if (!orderChanged) {
                return;
              }

              setOrderedFramingOptions(reordered);

              submitReorder(reordered);
            }}
          >
            <s-stack direction="block" gap="small-200">
              {orderedFramingOptions.map((option, index) => (
                <SortableFramingRow
                  key={option.id}
                  option={option}
                  index={index}
                  editable={editable}
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
              commandFor="add-framing"
              command="--show"
              onClick={() => setAddModalResetKey((key) => key + 1)}
            >
              Add framing option
            </s-button>
          </s-stack>
        ) : null}
      </s-stack>

      {editable ? (
        <AddFramingModal
          submitting={submittingIntent === "addFraming"}
          resetSignal={addModalResetKey}
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
