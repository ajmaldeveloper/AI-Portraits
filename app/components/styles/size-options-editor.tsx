import { useEffect, useState } from "react";
import { move } from "@dnd-kit/helpers";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { Form, useNavigation, useSubmit } from "react-router";

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

function validateSizeForm(
  values: SizeFormState,
  otherLabels: string[],
): SizeFormErrors {
  const errors: SizeFormErrors = {};

  const label = values.label.trim();

  if (!label) {
    errors.label = "Name is required.";
  } else if (
    otherLabels.some(
      (existing) => existing.toLowerCase() === label.toLowerCase(),
    )
  ) {
    errors.label = "A size with this name already exists.";
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
  resetSignal,
  existingLabels,
}: {
  submitting: boolean;
  resetSignal: number;
  existingLabels: string[];
}) {
  const [values, setValues] = useState<SizeFormState>(blankSizeValues);

  const [errors, setErrors] = useState<SizeFormErrors>({});

  const dirty = values.label.trim().length > 0;

  const reset = () => {
    setValues(blankSizeValues);
    setErrors({});
  };

  // Resets in place (not via remounting the modal) — a key-based
  // remount raced with the trigger button's native --show command,
  // which targets the modal element by id: the old element could be
  // torn down and replaced by a new one in the same click before the
  // show command reached it, leaving the popup never actually opening.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reset, [resetSignal]);

  return (
    <s-modal id="add-size" heading="Add size">
      <Form
        method="post"
        onSubmit={(event) => {
          const validationErrors = validateSizeForm(values, existingLabels);

          if (Object.keys(validationErrors).length > 0) {
            event.preventDefault();
            setErrors(validationErrors);
          }

          // Do NOT reset values here — this fires synchronously the
          // instant Add is clicked, while the request is still in
          // flight, which blanked the form out from under the
          // merchant before it even finished submitting. The trigger
          // button resets it instead, right before a fresh modal opens.
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
  otherLabels,
}: {
  option: SizeOptionView;
  submitting: boolean;
  otherLabels: string[];
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
          const validationErrors = validateSizeForm(values, otherLabels);

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

// Draggable row using @dnd-kit — same library/pattern as this app's
// Customer fields tab (see SortableFieldRow in customer-fields.tsx).
function SortableSizeRow({
  option,
  index,
  editable,
}: {
  option: SizeOptionView;
  index: number;
  editable: boolean;
}) {
  const { ref, handleRef, isDragging, isDropTarget } = useSortable({
    id: option.id,
    index,
    group: "size-options",
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
        </s-stack>
      </div>
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

  // Triggers AddSizeModal's own reset effect (see its resetSignal prop)
  // right before a fresh modal opens — its values must NOT reset the
  // instant Add is clicked, since that happens while the request is
  // still in flight, before the merchant even sees it submit.
  const [addModalResetKey, setAddModalResetKey] = useState(0);

  const submit = useSubmit();

  // Local, reorderable copy — updated instantly on drop so dragging
  // feels immediate, then synced back once the loader data reflects
  // the persisted order (or reverted if the save fails). Same pattern
  // as CustomerFields' orderedFields.
  const [orderedSizeOptions, setOrderedSizeOptions] = useState(sizeOptions);

  useEffect(() => {
    setOrderedSizeOptions(sizeOptions);
  }, [sizeOptions]);

  const submitReorder = (nextOptions: SizeOptionView[]) => {
    const formData = new FormData();

    formData.set("intent", "reorderSizes");

    for (const option of nextOptions) {
      formData.append("sizeOptionId", option.id);
    }

    submit(formData, { method: "post" });
  };

  return (
    <s-section heading="Sizes">
      <s-stack direction="block" gap="base">
        {sizeOptions.length === 0 ? (
          <s-text color="subdued">
            No sizes yet — this publishes as a single, one-size product.
          </s-text>
        ) : (
          <DragDropProvider
            onDragEnd={(event) => {
              if (event.canceled || !editable) {
                return;
              }

              const reordered = move(orderedSizeOptions, event);

              const orderChanged = reordered.some(
                (option, index) => option.id !== orderedSizeOptions[index]?.id,
              );

              if (!orderChanged) {
                return;
              }

              setOrderedSizeOptions(reordered);

              submitReorder(reordered);
            }}
          >
            <s-stack direction="block" gap="small-200">
              {orderedSizeOptions.map((option, index) => (
                <SortableSizeRow
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
              commandFor="add-size"
              command="--show"
              onClick={() => setAddModalResetKey((key) => key + 1)}
            >
              Add size
            </s-button>
          </s-stack>
        ) : null}
      </s-stack>

      {editable ? (
        <AddSizeModal
          submitting={submittingIntent === "addSize"}
          resetSignal={addModalResetKey}
          existingLabels={sizeOptions.map((option) => option.label)}
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
              otherLabels={sizeOptions
                .filter((other) => other.id !== option.id)
                .map((other) => other.label)}
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
