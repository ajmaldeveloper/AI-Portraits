import { useEffect, useState } from "react";
import { move } from "@dnd-kit/helpers";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { Form, useNavigation, useSubmit } from "react-router";

import { eventValue } from "../../utils/event-value";

export type MatColorView = {
  id: string;
  label: string;
  hexColor: string;
};

type MatColorFormState = {
  label: string;
  hexColor: string;
};

const blankMatColorValues: MatColorFormState = {
  label: "",
  hexColor: "#ffffff",
};

function matColorValuesOf(color: MatColorView): MatColorFormState {
  return {
    label: color.label,
    hexColor: color.hexColor,
  };
}

type MatColorFormErrors = Partial<Record<keyof MatColorFormState, string>>;

const hexColorPattern = /^#[0-9a-fA-F]{6}$/;

function validateMatColorForm(
  values: MatColorFormState,
  otherLabels: string[],
): MatColorFormErrors {
  const errors: MatColorFormErrors = {};

  const label = values.label.trim();

  if (!label) {
    errors.label = "Name is required.";
  } else if (
    otherLabels.some(
      (existing) => existing.toLowerCase() === label.toLowerCase(),
    )
  ) {
    errors.label = "A mat color with this name already exists.";
  }

  if (!hexColorPattern.test(values.hexColor.trim())) {
    errors.hexColor = "Enter a valid hex color (e.g. #ffffff).";
  }

  return errors;
}

function MatColorFormFields({
  values,
  errors,
  onChange,
}: {
  values: MatColorFormState;
  errors: MatColorFormErrors;
  onChange: (patch: Partial<MatColorFormState>) => void;
}) {
  return (
    <s-stack direction="block" gap="base">
      <s-text-field
        label="Name"
        name="label"
        value={values.label}
        onInput={(event: Event) => onChange({ label: eventValue(event) })}
        placeholder="e.g. Ivory"
        required
        autocomplete="off"
        error={errors.label}
      />

      <s-color-field
        label="Color"
        name="hexColor"
        value={values.hexColor}
        onInput={(event: Event) => onChange({ hexColor: eventValue(event) })}
        error={errors.hexColor}
      />
    </s-stack>
  );
}

function AddMatColorModal({
  submitting,
  resetSignal,
  existingLabels,
}: {
  submitting: boolean;
  resetSignal: number;
  existingLabels: string[];
}) {
  const [values, setValues] = useState<MatColorFormState>(blankMatColorValues);

  const [errors, setErrors] = useState<MatColorFormErrors>({});

  const dirty = values.label.trim().length > 0;

  const reset = () => {
    setValues(blankMatColorValues);
    setErrors({});
  };

  // Resets in place, not via remounting — see the identical comment in
  // size-options-editor.tsx's AddSizeModal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reset, [resetSignal]);

  return (
    <s-modal id="add-mat-color" heading="Add mat color">
      <Form
        method="post"
        onSubmit={(event) => {
          const validationErrors = validateMatColorForm(
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
        <input type="hidden" name="intent" value="addMatColor" />

        <s-stack direction="block" gap="base">
          <MatColorFormFields
            values={values}
            errors={errors}
            onChange={(patch) => {
              setValues((current) => ({ ...current, ...patch }));
              setErrors((current) => {
                const next = { ...current };

                for (const key of Object.keys(patch) as Array<
                  keyof MatColorFormState
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
              Add mat color
            </s-button>

            <s-button
              variant="secondary"
              commandFor="add-mat-color"
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

function EditMatColorModal({
  color,
  submitting,
  otherLabels,
}: {
  color: MatColorView;
  submitting: boolean;
  otherLabels: string[];
}) {
  const initialValues = matColorValuesOf(color);

  const [values, setValues] = useState<MatColorFormState>(initialValues);

  const [errors, setErrors] = useState<MatColorFormErrors>({});

  const isDirty =
    values.label !== initialValues.label ||
    values.hexColor !== initialValues.hexColor;

  return (
    <s-modal id={`edit-mat-color-${color.id}`} heading={`Edit ${color.label}`}>
      <Form
        method="post"
        onSubmit={(event) => {
          const validationErrors = validateMatColorForm(values, otherLabels);

          if (Object.keys(validationErrors).length > 0) {
            event.preventDefault();
            setErrors(validationErrors);
            return;
          }

          setErrors({});
        }}
      >
        <input type="hidden" name="intent" value="editMatColor" />

        <input type="hidden" name="matColorId" value={color.id} />

        <s-stack direction="block" gap="base">
          <MatColorFormFields
            values={values}
            errors={errors}
            onChange={(patch) => {
              setValues((current) => ({ ...current, ...patch }));
              setErrors((current) => {
                const next = { ...current };

                for (const key of Object.keys(patch) as Array<
                  keyof MatColorFormState
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
              commandFor={`edit-mat-color-${color.id}`}
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
function SortableMatColorRow({
  color,
  index,
  editable,
}: {
  color: MatColorView;
  index: number;
  editable: boolean;
}) {
  const { ref, handleRef, isDragging, isDropTarget } = useSortable({
    id: color.id,
    index,
    group: "mat-colors",
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
                commandFor={`edit-mat-color-${color.id}`}
                command="--show"
              >
                Edit
              </s-button>

              <s-button
                icon="delete"
                variant="tertiary"
                tone="critical"
                commandFor={`delete-mat-color-${color.id}`}
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

export function MatColorsEditor({
  matColors,
  editable,
}: {
  matColors: MatColorView[];
  editable: boolean;
}) {
  const navigation = useNavigation();

  const submitting =
    navigation.state !== "idle" && Boolean(navigation.formData);

  const submittingIntent = submitting
    ? navigation.formData?.get("intent")
    : null;

  const submittingMatColorId = submitting
    ? navigation.formData?.get("matColorId")
    : null;

  // Triggers AddMatColorModal's own reset effect right before a fresh
  // modal opens — see the identical comment in size-options-editor.tsx's
  // SizeOptionsEditor.
  const [addModalResetKey, setAddModalResetKey] = useState(0);

  const submit = useSubmit();

  const [orderedMatColors, setOrderedMatColors] = useState(matColors);

  useEffect(() => {
    setOrderedMatColors(matColors);
  }, [matColors]);

  const submitReorder = (nextColors: MatColorView[]) => {
    const formData = new FormData();

    formData.set("intent", "reorderMatColors");

    for (const color of nextColors) {
      formData.append("matColorId", color.id);
    }

    submit(formData, { method: "post" });
  };

  return (
    <s-section heading="Mat colors">
      <s-stack direction="block" gap="base">
        <s-text color="subdued">
          Shown as swatches on the storefront, independent of Framing —
          customers pick a mat color for the inner border regardless of
          which Framing option they chose. Purely visual and
          price-neutral; never sent to Shopify.
        </s-text>

        {matColors.length === 0 ? (
          <s-text color="subdued">No mat colors yet.</s-text>
        ) : (
          <DragDropProvider
            onDragEnd={(event) => {
              if (event.canceled || !editable) {
                return;
              }

              const reordered = move(orderedMatColors, event);

              const orderChanged = reordered.some(
                (color, index) =>
                  color.id !== orderedMatColors[index]?.id,
              );

              if (!orderChanged) {
                return;
              }

              setOrderedMatColors(reordered);

              submitReorder(reordered);
            }}
          >
            <s-stack direction="block" gap="small-200">
              {orderedMatColors.map((color, index) => (
                <SortableMatColorRow
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
              commandFor="add-mat-color"
              command="--show"
              onClick={() => setAddModalResetKey((key) => key + 1)}
            >
              Add mat color
            </s-button>
          </s-stack>
        ) : null}
      </s-stack>

      {editable ? (
        <AddMatColorModal
          submitting={submittingIntent === "addMatColor"}
          resetSignal={addModalResetKey}
          existingLabels={matColors.map((color) => color.label)}
        />
      ) : null}

      {editable
        ? matColors.map((color) => (
            <EditMatColorModal
              key={`edit-${color.id}`}
              color={color}
              submitting={
                submittingIntent === "editMatColor" &&
                submittingMatColorId === color.id
              }
              otherLabels={matColors
                .filter((other) => other.id !== color.id)
                .map((other) => other.label)}
            />
          ))
        : null}

      {editable
        ? matColors.map((color) => (
            <s-modal
              key={`delete-${color.id}`}
              id={`delete-mat-color-${color.id}`}
              heading="Delete mat color?"
            >
              <Form method="post">
                <input type="hidden" name="intent" value="deleteMatColor" />

                <input type="hidden" name="matColorId" value={color.id} />

                <s-stack direction="block" gap="base">
                  <s-paragraph>
                    Delete "{color.label}"? This mat color will no longer
                    be offered to customers.
                  </s-paragraph>

                  <s-stack direction="inline" gap="base">
                    <s-button
                      variant="secondary"
                      commandFor={`delete-mat-color-${color.id}`}
                      command="--hide"
                      disabled={
                        submittingIntent === "deleteMatColor" &&
                        submittingMatColorId === color.id
                      }
                    >
                      Cancel
                    </s-button>

                    <s-button
                      type="submit"
                      variant="primary"
                      tone="critical"
                      loading={
                        submittingIntent === "deleteMatColor" &&
                        submittingMatColorId === color.id
                      }
                      disabled={
                        submittingIntent === "deleteMatColor" &&
                        submittingMatColorId === color.id
                      }
                    >
                      Delete mat color
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
