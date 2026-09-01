import { useEffect, useState } from "react";
import { move } from "@dnd-kit/helpers";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { Form, useNavigation, useSubmit } from "react-router";

import { eventValue } from "../../utils/event-value";

export type FrameColorView = {
  id: string;
  label: string;
  hexColor: string;
};

type FrameColorFormState = {
  label: string;
  hexColor: string;
};

const blankFrameColorValues: FrameColorFormState = {
  label: "",
  hexColor: "#1a1a1a",
};

function frameColorValuesOf(color: FrameColorView): FrameColorFormState {
  return {
    label: color.label,
    hexColor: color.hexColor,
  };
}

type FrameColorFormErrors = Partial<Record<keyof FrameColorFormState, string>>;

const hexColorPattern = /^#[0-9a-fA-F]{6}$/;

function validateFrameColorForm(
  values: FrameColorFormState,
  otherLabels: string[],
): FrameColorFormErrors {
  const errors: FrameColorFormErrors = {};

  const label = values.label.trim();

  if (!label) {
    errors.label = "Name is required.";
  } else if (
    otherLabels.some(
      (existing) => existing.toLowerCase() === label.toLowerCase(),
    )
  ) {
    errors.label = "A frame color with this name already exists.";
  }

  if (!hexColorPattern.test(values.hexColor.trim())) {
    errors.hexColor = "Enter a valid hex color (e.g. #1a1a1a).";
  }

  return errors;
}

function FrameColorFormFields({
  values,
  errors,
  onChange,
}: {
  values: FrameColorFormState;
  errors: FrameColorFormErrors;
  onChange: (patch: Partial<FrameColorFormState>) => void;
}) {
  return (
    <s-stack direction="block" gap="base">
      <s-text-field
        label="Name"
        name="label"
        value={values.label}
        onInput={(event: Event) => onChange({ label: eventValue(event) })}
        placeholder="e.g. Black"
        required
        autocomplete="off"
        error={errors.label}
      />

      <s-stack direction="inline" gap="small-200" alignItems="end">
        <s-text-field
          label="Hex color"
          name="hexColor"
          value={values.hexColor}
          onInput={(event: Event) => onChange({ hexColor: eventValue(event) })}
          placeholder="e.g. #1a1a1a"
          required
          autocomplete="off"
          error={errors.hexColor}
        />

        <input
          type="color"
          aria-label="Pick a color"
          value={
            hexColorPattern.test(values.hexColor) ? values.hexColor : "#1a1a1a"
          }
          onChange={(event) => onChange({ hexColor: event.currentTarget.value })}
          style={{
            width: 32,
            height: 32,
            padding: 0,
            border: "1px solid #d1d1d1",
            borderRadius: 6,
            cursor: "pointer",
            flex: "0 0 auto",
            marginBottom: 4,
          }}
        />
      </s-stack>
    </s-stack>
  );
}

function AddFrameColorModal({
  submitting,
  resetSignal,
  existingLabels,
}: {
  submitting: boolean;
  resetSignal: number;
  existingLabels: string[];
}) {
  const [values, setValues] = useState<FrameColorFormState>(
    blankFrameColorValues,
  );

  const [errors, setErrors] = useState<FrameColorFormErrors>({});

  const dirty = values.label.trim().length > 0;

  const reset = () => {
    setValues(blankFrameColorValues);
    setErrors({});
  };

  // Resets in place, not via remounting — see the identical comment in
  // size-options-editor.tsx's AddSizeModal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reset, [resetSignal]);

  return (
    <s-modal id="add-frame-color" heading="Add frame color">
      <Form
        method="post"
        onSubmit={(event) => {
          const validationErrors = validateFrameColorForm(
            values,
            existingLabels,
          );

          if (Object.keys(validationErrors).length > 0) {
            event.preventDefault();
            setErrors(validationErrors);
          }

          // Do NOT reset values here — see AddSizeModal's identical
          // comment. The trigger button resets it instead, right
          // before a fresh modal opens.
        }}
      >
        <input type="hidden" name="intent" value="addFrameColor" />

        <s-stack direction="block" gap="base">
          <FrameColorFormFields
            values={values}
            errors={errors}
            onChange={(patch) => {
              setValues((current) => ({ ...current, ...patch }));
              setErrors((current) => {
                const next = { ...current };

                for (const key of Object.keys(patch) as Array<
                  keyof FrameColorFormState
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
              Add frame color
            </s-button>

            <s-button
              variant="secondary"
              commandFor="add-frame-color"
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

function EditFrameColorModal({
  color,
  submitting,
  otherLabels,
}: {
  color: FrameColorView;
  submitting: boolean;
  otherLabels: string[];
}) {
  const initialValues = frameColorValuesOf(color);

  const [values, setValues] = useState<FrameColorFormState>(initialValues);

  const [errors, setErrors] = useState<FrameColorFormErrors>({});

  const isDirty =
    values.label !== initialValues.label ||
    values.hexColor !== initialValues.hexColor;

  return (
    <s-modal id={`edit-frame-color-${color.id}`} heading={`Edit ${color.label}`}>
      <Form
        method="post"
        onSubmit={(event) => {
          const validationErrors = validateFrameColorForm(values, otherLabels);

          if (Object.keys(validationErrors).length > 0) {
            event.preventDefault();
            setErrors(validationErrors);
            return;
          }

          setErrors({});
        }}
      >
        <input type="hidden" name="intent" value="editFrameColor" />

        <input type="hidden" name="frameColorId" value={color.id} />

        <s-stack direction="block" gap="base">
          <FrameColorFormFields
            values={values}
            errors={errors}
            onChange={(patch) => {
              setValues((current) => ({ ...current, ...patch }));
              setErrors((current) => {
                const next = { ...current };

                for (const key of Object.keys(patch) as Array<
                  keyof FrameColorFormState
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
              commandFor={`edit-frame-color-${color.id}`}
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
function SortableFrameColorRow({
  color,
  index,
  editable,
}: {
  color: FrameColorView;
  index: number;
  editable: boolean;
}) {
  const { ref, handleRef, isDragging, isDropTarget } = useSortable({
    id: color.id,
    index,
    group: "frame-colors",
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
          aria-label={`Drag ${color.label} to reorder`}
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
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <div
              aria-hidden="true"
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: color.hexColor,
                border: "1px solid rgba(0,0,0,0.15)",
                flex: "0 0 auto",
              }}
            />

            <s-text type="strong">{color.label}</s-text>

            <s-badge tone="neutral">{color.hexColor}</s-badge>
          </s-stack>

          {editable ? (
            <s-stack direction="inline" gap="small">
              <s-button
                variant="tertiary"
                commandFor={`edit-frame-color-${color.id}`}
                command="--show"
              >
                Edit
              </s-button>

              <s-button
                icon="delete"
                variant="tertiary"
                tone="critical"
                commandFor={`delete-frame-color-${color.id}`}
                command="--show"
                accessibilityLabel={`Delete ${color.label}`}
              />
            </s-stack>
          ) : null}
        </s-stack>
      </div>
    </div>
  );
}

export function FrameColorsEditor({
  frameColors,
  editable,
}: {
  frameColors: FrameColorView[];
  editable: boolean;
}) {
  const navigation = useNavigation();

  const submitting =
    navigation.state !== "idle" && Boolean(navigation.formData);

  const submittingIntent = submitting
    ? navigation.formData?.get("intent")
    : null;

  const submittingFrameColorId = submitting
    ? navigation.formData?.get("frameColorId")
    : null;

  // Triggers AddFrameColorModal's own reset effect right before a
  // fresh modal opens — see the identical comment in
  // size-options-editor.tsx's SizeOptionsEditor.
  const [addModalResetKey, setAddModalResetKey] = useState(0);

  const submit = useSubmit();

  const [orderedFrameColors, setOrderedFrameColors] = useState(frameColors);

  useEffect(() => {
    setOrderedFrameColors(frameColors);
  }, [frameColors]);

  const submitReorder = (nextColors: FrameColorView[]) => {
    const formData = new FormData();

    formData.set("intent", "reorderFrameColors");

    for (const color of nextColors) {
      formData.append("frameColorId", color.id);
    }

    submit(formData, { method: "post" });
  };

  return (
    <s-section heading="Frame colors">
      <s-stack direction="block" gap="base">
        <s-text color="subdued">
          Shown as swatches on the storefront — any color can be combined with
          any frame style. Purely visual; never sent to Shopify.
        </s-text>

        {frameColors.length === 0 ? (
          <s-text color="subdued">No frame colors yet.</s-text>
        ) : (
          <DragDropProvider
            onDragEnd={(event) => {
              if (event.canceled || !editable) {
                return;
              }

              const reordered = move(orderedFrameColors, event);

              const orderChanged = reordered.some(
                (color, index) =>
                  color.id !== orderedFrameColors[index]?.id,
              );

              if (!orderChanged) {
                return;
              }

              setOrderedFrameColors(reordered);

              submitReorder(reordered);
            }}
          >
            <s-stack direction="block" gap="small-200">
              {orderedFrameColors.map((color, index) => (
                <SortableFrameColorRow
                  key={color.id}
                  color={color}
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
              commandFor="add-frame-color"
              command="--show"
              onClick={() => setAddModalResetKey((key) => key + 1)}
            >
              Add frame color
            </s-button>
          </s-stack>
        ) : null}
      </s-stack>

      {editable ? (
        <AddFrameColorModal
          submitting={submittingIntent === "addFrameColor"}
          resetSignal={addModalResetKey}
          existingLabels={frameColors.map((color) => color.label)}
        />
      ) : null}

      {editable
        ? frameColors.map((color) => (
            <EditFrameColorModal
              key={`edit-${color.id}`}
              color={color}
              submitting={
                submittingIntent === "editFrameColor" &&
                submittingFrameColorId === color.id
              }
              otherLabels={frameColors
                .filter((other) => other.id !== color.id)
                .map((other) => other.label)}
            />
          ))
        : null}

      {editable
        ? frameColors.map((color) => (
            <s-modal
              key={`delete-${color.id}`}
              id={`delete-frame-color-${color.id}`}
              heading="Delete frame color?"
            >
              <Form method="post">
                <input type="hidden" name="intent" value="deleteFrameColor" />

                <input type="hidden" name="frameColorId" value={color.id} />

                <s-stack direction="block" gap="base">
                  <s-paragraph>
                    Delete “{color.label}”? This color will no longer be
                    offered to customers.
                  </s-paragraph>

                  <s-stack direction="inline" gap="base">
                    <s-button
                      variant="secondary"
                      commandFor={`delete-frame-color-${color.id}`}
                      command="--hide"
                      disabled={
                        submittingIntent === "deleteFrameColor" &&
                        submittingFrameColorId === color.id
                      }
                    >
                      Cancel
                    </s-button>

                    <s-button
                      type="submit"
                      variant="primary"
                      tone="critical"
                      loading={
                        submittingIntent === "deleteFrameColor" &&
                        submittingFrameColorId === color.id
                      }
                      disabled={
                        submittingIntent === "deleteFrameColor" &&
                        submittingFrameColorId === color.id
                      }
                    >
                      Delete frame color
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
